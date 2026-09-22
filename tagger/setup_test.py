#!/usr/bin/env python3
import os
import zipfile
import requests

COVER_URL = "https://static.wikia.nocookie.net/marvel_dc/images/1/1a/Watchmen_Vol_1_1.jpg"
CBZ_NAME = "watchmen_tpb.cbz"

def setup():
    print(f"[*] Downloading test cover image from Fandom...")
    
    temp_cover = "000_cover.jpg"
    try:
        import subprocess
        subprocess.run(["curl", "-L", "-s", "-o", temp_cover, COVER_URL], check=True)
    except Exception as e:
        print(f"[-] Failed to download using curl: {e}")
        return
        
    print("[+] Cover image downloaded.")

    print(f"[*] Packaging {CBZ_NAME}...")
    if os.path.exists(CBZ_NAME):
        os.remove(CBZ_NAME)
        
    with zipfile.ZipFile(CBZ_NAME, 'w') as z:
        # Add the cover as the first page (so it's extracted first alphabetically)
        z.write(temp_cover, "000_cover.jpg")
        
        # Add a couple of dummy text pages to simulate comic contents
        z.writestr("001_page1.txt", "Page 1 - Who watches the Watchmen?")
        z.writestr("002_page2.txt", "Page 2 - Under the Hood")
        
    print(f"[+] Successfully created digital comic archive: {CBZ_NAME}")
    
    # Clean up local temp file
    if os.path.exists(temp_cover):
        os.remove(temp_cover)
        
    print("\n" + "="*50)
    print("READY FOR TESTING!")
    print("="*50)
    print(f"A test file named '{CBZ_NAME}' has been created in your directory.")
    print("To test the tagger, make sure you have the required libraries installed:")
    print("  pip install requests beautifulsoup4")
    print("\nThen run the script (if you have a SerpApi key):")
    print(f"  python tagger.py {CBZ_NAME} --api-key YOUR_SERPAPI_KEY")
    print("="*50)

if __name__ == "__main__":
    setup()
