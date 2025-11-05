#!/bin/bash
set -e # Exit immediately if a command exits with a non-zero status.

# --- Configuration ---
# Set the resolution (DPI) for the output images. 150 is good for screens.
# Increase to 300 for very high-quality source material.
DPI=300
# Set the JPEG quality (1-100). 90 is a good balance.
JPEG_QUALITY=100
# --- End Configuration ---

# --- Check Dependencies ---
command -v pdftoppm >/dev/null 2>&1 || {
    echo >&2 "Error: 'pdftoppm' is not installed."
    echo >&2 "Please install it with: sudo apt install poppler-utils"
    exit 1
}
command -v zip >/dev/null 2>&1 || {
    echo >&2 "Error: 'zip' is not installed."
    echo >&2 "Please install it with: sudo apt install zip"
    exit 1
}

# --- Validate Input ---
if [ "$#" -eq 0 ]; then
    echo "Usage: $0 <file1.pdf> [file2.pdf] ... or \"*.pdf\""
    echo "Example: $0 \"My Comic.pdf\""
    echo "Example (Batch): $0 *.pdf"
    exit 1
fi

# --- Setup Global Cleanup ---
# We will add all created temp directories to this array
TEMP_DIRS_TO_CLEAN=()

# Define a cleanup function
cleanup() {
    echo "Cleaning up all temporary directories..."
    for dir in "${TEMP_DIRS_TO_CLEAN[@]}"; do
        if [ -d "$dir" ]; then
            rm -rf "$dir"
        fi
    done
    echo "Cleanup complete."
}

# Register the cleanup function to run when the script exits (success or fail)
trap cleanup EXIT

# --- Main Processing Loop ---
# Loop through every argument passed to the script
for INPUT_PDF in "$@"; do

    echo "-----------------------------------------"
    echo "Processing: $INPUT_PDF"
    echo "-----------------------------------------"

    # --- 1. Validate this specific file ---
    if [ ! -f "$INPUT_PDF" ]; then
        echo "Error: File not found: $INPUT_PDF"
        echo "Skipping."
        continue # Skip to the next file in the loop
    fi

    # --- 2. Set up filenames ---
    BASENAME=$(basename "$INPUT_PDF" .pdf)
    OUTPUT_CBZ="${BASENAME}.cbz"

    if [ -f "$OUTPUT_CBZ" ]; then
        echo "Error: Output file already exists: $OUTPUT_CBZ"
        echo "Skipping to avoid overwrite."
        continue # Skip to the next file
    fi

    # --- 3. Create Temp Directory for this file ---
    TEMP_DIR=$(mktemp -d)
    TEMP_DIRS_TO_CLEAN+=("$TEMP_DIR") # Add to our global cleanup list
    echo "Temporary dir: $TEMP_DIR"

    # --- 4. Convert PDF pages to images ---
    echo "Converting PDF to images (DPI: $DPI, Quality: $JPEG_QUALITY)..."

    # Run pdftoppm. Add error handling in case it fails.
    if ! pdftoppm -r $DPI -jpeg -jpegopt "quality=$JPEG_QUALITY" "$INPUT_PDF" "$TEMP_DIR/page"; then
        echo "Error: pdftoppm failed for $INPUT_PDF."
        echo "Skipping."
        continue # Skip to the next file
    fi

    # Check if images were created
    if [ -z "$(ls -A "$TEMP_DIR")" ]; then
        echo "Error: No images were created by pdftoppm."
        echo "Skipping."
        continue # Skip to the next file
    fi

    # --- 5. Create the CBZ (zip) file ---
    echo "Creating CBZ archive: $OUTPUT_CBZ"
    # -j: "Junks" the paths (stores files at the root of the zip)
    zip -j "$OUTPUT_CBZ" "$TEMP_DIR"/page-*.jpg

    echo "Conversion successful!"
    echo "Output file: $OUTPUT_CBZ"

done

echo "-----------------------------------------"
echo "All files processed."
# The 'trap' will handle all cleanup automatically
exit 0
