import os
import glob

for filepath in glob.glob("*.html"):
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    
    # Replace 'index.html' with '/'
    new_content = content.replace("window.location.href = 'index.html';", "window.location.href = '/';")
    new_content = new_content.replace('window.location.href = "index.html";', 'window.location.href = "/";')
    
    if new_content != content:
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(new_content)
        print(f"Updated {filepath}")
