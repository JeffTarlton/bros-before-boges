import os
import sys
try:
    from PIL import Image
    from pillow_heif import register_heif_opener
except ImportError:
    print("Please install pillow and pillow-heif: pip install pillow pillow-heif")
    sys.exit(1)

register_heif_opener()

folder_path = r"assets\past years"
for filename in os.listdir(folder_path):
    if filename.lower().endswith(".heic"):
        heic_path = os.path.join(folder_path, filename)
        jpg_path = os.path.join(folder_path, os.path.splitext(filename)[0] + ".jpg")
        
        try:
            image = Image.open(heic_path)
            # Remove alpha channel if it exists since JPG doesn't support it
            if image.mode in ("RGBA", "P"):
                image = image.convert("RGB")
            
            # Save the image as JPG
            image.save(jpg_path, "JPEG", quality=85)
            print(f"Converted {filename} to JPG.")
            # Delete original heic (optional, but requested implicitly by converting them)
            os.remove(heic_path)
        except Exception as e:
            print(f"Error converting {filename}: {e}")
