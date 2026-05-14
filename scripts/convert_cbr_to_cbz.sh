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

# Loop through all files provided as arguments
for cbr_file in "$@"; do

    # Check if it's a .cbr file
    if [[ "${cbr_file##*.}" != "cbr" ]]; then
        echo "Skipping $cbr_file: Not a .cbr file."
        continue
    fi

    # Get the base filename without the .cbr extension
    base_name=$(basename "$cbr_file" .cbr)
    cbz_file="${base_name}.cbz"

    # Create a unique temporary directory
    temp_dir=$(mktemp -d "${base_name}_XXXXXX")

    echo "--- Processing $cbr_file ---"

    # 1. Extract the CBR file into the temp directory
    echo "Extracting $cbr_file..."
    unrar x "$cbr_file" "$temp_dir/" > /dev/null

    if [ $? -ne 0 ]; then
        echo "Error: Failed to extract $cbr_file. Skipping."
        rm -rf "$temp_dir" # Clean up failed attempt
        continue
    fi

    # 2. Change into the temp directory
    cd "$temp_dir"

    # 3. Create the new CBZ (Zip) file with 0 compression
    echo "Creating $cbz_file (store-only)..."
    zip -0 -r -q "../$cbz_file" .

    # Store the exit code of the zip command
    zip_success=$?

    # 4. Change back to the original directory
    cd "$original_dir"

    # 5. Check if zip was successful, THEN delete original
    if [ $zip_success -eq 0 ]; then
        echo "Successfully created $cbz_file"
        echo "Removing original $cbr_file..."
        rm "$cbr_file"
    else
        echo "Error: Failed to create $cbz_file. Original file NOT deleted."
    fi

    # 6. Clean up the temporary directory
    rm -rf "$temp_dir"
    echo "-----------------------------"

done

echo "All tasks complete."
