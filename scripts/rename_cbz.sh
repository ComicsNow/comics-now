#!/bin/bash

# Rename a CBZ file based on ComicInfo.xml metadata.
# Usage: rename_cbz.sh <cbz_file>

rename_cbz() {
  local filepath="$1"

  RENAMED_FILEPATH=""
  RENAMED_PUBLISHER=""

  if [ ! -f "$filepath" ]; then
    echo "Warning: File not found. Skipping."
    return 1
  fi

  local xml_content
  xml_content=$(unzip -p "$filepath" ComicInfo.xml 2>/dev/null)
  if [ -z "$xml_content" ]; then
    echo "Warning: ComicInfo.xml not found in '$filepath'. Skipping."
    return 1
  fi

  get_xml_tag() {
    echo "$1" | xmllint --xpath "string(/ComicInfo/$2)" - 2>/dev/null
  }

  local series issue title year cover_date publisher page_count volume
  series=$(get_xml_tag "$xml_content" "Series")
  issue=$(get_xml_tag "$xml_content" "Number")
  title=$(get_xml_tag "$xml_content" "Title")
  year=$(get_xml_tag "$xml_content" "Year")
  cover_date=$(get_xml_tag "$xml_content" "CoverDate")
  publisher=$(get_xml_tag "$xml_content" "Publisher")
  page_count=$(get_xml_tag "$xml_content" "PageCount")
  volume=$(get_xml_tag "$xml_content" "Volume")

  if [[ -z "$series" || -z "$publisher" || (-z "$year" && -z "$cover_date") ]]; then
    echo "Warning: Missing required tag (Series, Publisher, or Year/CoverDate). Skipping."
    return 1
  fi

  local display_year=""
  if [ -n "$year" ]; then
    display_year="$year"
  elif [ -n "$cover_date" ]; then
    display_year="${cover_date:0:4}"
  fi

  local new_name=""
  if [ -n "$issue" ]; then
    local formatted_issue="$issue"
    if [[ "$issue" =~ ^[0-9]+$ ]]; then
      formatted_issue=$(printf "%02d" "$issue")
    fi
    new_name="${formatted_issue} "
  fi
  new_name+="$series"
  if [ -n "$title" ]; then
    new_name+=" - $title"
  fi
  new_name+=" [$publisher] ($display_year)"
  if [ -n "$page_count" ]; then
    new_name+=" #$page_count"
  fi
  new_name+=".cbz"

  local safe_new_name
  safe_new_name=$(echo "$new_name" | tr '/' '-')
  local dir
  dir=$(dirname "$filepath")
  local original_basename
  original_basename=$(basename "$filepath")
  local new_filepath="$dir/$safe_new_name"

  if [ "$original_basename" != "$safe_new_name" ]; then
    echo "Renaming to: $safe_new_name"
    mv -v "$filepath" "$new_filepath"
    filepath="$new_filepath"
  else
    echo "Info: Filename already correct."
  fi

  RENAMED_FILEPATH="$filepath"
  RENAMED_PUBLISHER="$publisher"
  return 0
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  if [ "$#" -ne 1 ]; then
    echo "Usage: $0 <cbz_file>"
    exit 1
  fi

  if rename_cbz "$1"; then
    exit 0
  else
    exit 1
  fi
fi