# 🎬 Video Merger

A free, browser-based video merger that works on iPhone 6 and other devices. No server, no watermark, no cost — everything runs directly in your browser using FFmpeg.wasm.

## ✨ Features

- 🎥 Merge up to 100 videos in one go
- 📱 Output encoded for iPhone 6 (H.264 Baseline / AAC)
- 🖼️ Auto-generated thumbnails for each video
- 🔀 Drag to reorder videos before merging
- 📊 Progress bar during merge
- ⬇️ Download merged video instantly
- 💻 100% browser-based — no upload to any server
- 🆓 Completely free, no watermark

## 🚀 Live Demo

👉 [Try it here](https://your-netlify-url.netlify.app)

## 🛠️ How it works

This app uses [FFmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) to run FFmpeg directly in the browser. No files are ever uploaded to a server — all processing happens on your device.

## 📦 Run locally (optional)

If you want to run it locally with the Python backend:

### Requirements
- Python 3.8+
- [FFmpeg](https://www.gyan.dev/ffmpeg/builds/) — download and update the `FFMPEG` path in `app.py`

### Setup

```bash
pip install -r requirements.txt
python app.py
```

Then open **http://localhost:5000** in your browser.

## 📁 Project Structure

```
├── index.html        # Main frontend (browser-based FFmpeg.wasm)
├── app.py            # Optional Python/Flask backend (local use)
├── requirements.txt  # Python dependencies
├── neat.umd.js       # NeatGradient animation library (local copy)
├── Dockerfile        # Docker config (for self-hosting)
└── README.md
```

## 📱 iPhone 6 Compatibility

All merged videos are re-encoded to:
- Video: H.264 Baseline Profile Level 3.0
- Audio: AAC 44.1kHz Stereo
- Container: MP4 with faststart flag

This ensures full compatibility with iPhone 6 and other older devices.

## 📄 License

Free to use for personal and commercial projects.
