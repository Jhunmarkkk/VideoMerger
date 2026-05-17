# 🎬 Video Merger

A free, browser-based video merger that works on iPhone 6 and other devices.

## Features
- Upload up to 100 videos
- Drag to reorder before merging
- Auto-generated thumbnails
- Progress bars for upload and merge
- Output encoded for iPhone 6 (H.264 Baseline / AAC)
- 100% free, no watermark

## Requirements
- Python 3.8+
- [FFmpeg](https://www.gyan.dev/ffmpeg/builds/) (add `bin` folder to PATH or update `FFMPEG` path in `app.py`)

## Setup

```bash
pip install -r requirements.txt
python app.py
```

Then open **http://localhost:5000** in your browser.

## Notes
- Update the `FFMPEG` variable in `app.py` to point to your local `ffmpeg.exe`
- Do not use the development server in production
