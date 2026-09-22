#!/bin/bash

# Script to convert CBR (Rar) to CBZ (Zip) with 0 compression (store-only)
# !! WARNING: This script DELETES the original .cbr file on success. !!
#
# Dependencies: 'unrar' and 'zip'

# Check for dependencies
if ! command -v unrar &> /dev/null; then
    echo "Error: 'unrar' is not installed."
    echo "Please install it (e.g., sudo apt install unrar) and try again."
    exit 1
fi

if ! command -v zip &> /dev/null; then
    echo "Error: 'zip' is not installed."
    echo "Please install it (e.g., sudo apt install zip) and try again."
    exit 1
fi

# Check if any files were provided
if [ $# -eq 0 ]; then
    echo "Usage: $0 file1.cbr [file2.cbr] ..."
    exit 1
fi

# Save the current directory
original_dir=$(pwd)
has_error=0

# Loop through all files provided as arguments
for cbr_file in "$@"; do

    # Check if it's a .cbr file
    if [[ "${cbr_file##*.}" != "cbr" ]]; then
        echo "Skipping $cbr_file: Not a .cbr file." >&2
        continue
    fi

    # Get the base filename without the .cbr extension
    base_name=$(basename "$cbr_file" .cbr)
    cbz_file="${base_name}.cbz"

    # Create a unique temporary directory in the current working directory
    temp_dir=$(mktemp -d "./.cbr_conv_${base_name//[^a-zA-Z0-9_]/_}_XXXXXX")
    if [ $? -ne 0 ] || [ ! -d "$temp_dir" ]; then
        echo "Error: Failed to create temporary directory for $cbr_file." >&2
        has_error=1
        continue
    fi

    echo "--- Processing $cbr_file ---"

    # 1. Extract the CBR file into the temp directory
    echo "Extracting $cbr_file..."
    unrar_output=$(unrar x -o+ -y "$cbr_file" "$temp_dir/" 2>&1)
    unrar_code=$?

    if [ $unrar_code -ne 0 ]; then
        echo "Error: Failed to extract $cbr_file (unrar code $unrar_code)." >&2
        echo "$unrar_output" | tail -n 5 >&2
        rm -rf "$temp_dir" # Clean up failed attempt
        has_error=1
        continue
    fi

    # 2. Change into the temp directory
    cd "$temp_dir" || { rm -rf "$temp_dir"; has_error=1; continue; }

    # 3. Create the new CBZ (Zip) file with 0 compression
    echo "Creating $cbz_file (store-only)..."
    zip_output=$(zip -0 -r -q "../$cbz_file" . 2>&1)
    zip_success=$?

    # 4. Change back to the original directory
    cd "$original_dir" || exit 1

    # 5. Check if zip was successful, THEN delete original
    if [ $zip_success -eq 0 ] && [ -f "$cbz_file" ]; then
        echo "Successfully created $cbz_file"
        echo "Removing original $cbr_file..."
        rm "$cbr_file"
    else
        echo "Error: Failed to create $cbz_file (zip code $zip_success). Original file NOT deleted." >&2
        if [ -n "$zip_output" ]; then echo "$zip_output" >&2; fi
        has_error=1
    fi

    # 6. Clean up the temporary directory
    rm -rf "$temp_dir"
    echo "-----------------------------"

done

if [ $has_error -ne 0 ]; then
    echo "One or more files failed conversion." >&2
    exit 1
fi

echo "All tasks complete."
exit 0
