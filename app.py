import os
import shutil
import subprocess
import uuid
from flask import Flask, request, jsonify, send_file, after_this_request, send_from_directory
from flask_cors import CORS

app = Flask(__name__, static_folder=".", static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024 * 1024  # 10 GB
CORS(app)

UPLOAD_FOLDER = "uploads"
OUTPUT_FOLDER = "outputs"
THUMB_FOLDER = "thumbnails"

for folder in [UPLOAD_FOLDER, OUTPUT_FOLDER, THUMB_FOLDER]:
    os.makedirs(folder, exist_ok=True)

FFMPEG = os.environ.get("FFMPEG_PATH") or shutil.which("ffmpeg") or "ffmpeg"
print(f"FFmpeg path: {FFMPEG}", flush=True)

MAX_FILES = 100


@app.errorhandler(413)
def too_large(e):
    return jsonify({"error": "File too large."}), 413


@app.route("/upload", methods=["POST"])
def upload():
    try:
        files = request.files.getlist("videos")
        files = [f for f in files if f and f.filename]
        if not files:
            return jsonify({"error": "No video file received."}), 400
        if len(files) > MAX_FILES:
            return jsonify({"error": f"Max {MAX_FILES} files allowed."}), 400

        saved = []
        for f in files:
            fid = str(uuid.uuid4())
            ext = os.path.splitext(f.filename)[1].lower() or ".mp4"
            path = os.path.join(UPLOAD_FOLDER, fid + ext)
            f.save(path)

            thumb_path = os.path.join(THUMB_FOLDER, fid + ".jpg")
            subprocess.run(
                [FFMPEG, "-y", "-i", path, "-ss", "00:00:01", "-vframes", "1",
                 "-vf", "scale=320:-1", thumb_path],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )

            saved.append({
                "id": fid,
                "name": f.filename,
                "path": path,
                "thumb": f"/thumbnail/{fid}.jpg"
            })

        return jsonify({"files": saved})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/thumbnail/<filename>")
def thumbnail(filename):
    path = os.path.join(THUMB_FOLDER, filename)
    if not os.path.exists(path):
        return "", 404
    return send_file(path, mimetype="image/jpeg")


@app.route("/merge", methods=["POST"])
def merge():
    try:
        data = request.json
        ids = data.get("ids", [])
        if not ids or len(ids) > MAX_FILES:
            return jsonify({"error": "Invalid file list."}), 400

        list_path = os.path.join(OUTPUT_FOLDER, str(uuid.uuid4()) + "_list.txt")
        output_id = str(uuid.uuid4())
        output_path = os.path.join(OUTPUT_FOLDER, output_id + ".mp4")

        converted = []
        for fid in ids:
            matches = [f for f in os.listdir(UPLOAD_FOLDER) if f.startswith(fid)]
            if not matches:
                return jsonify({"error": f"File {fid} not found."}), 404
            src = os.path.join(UPLOAD_FOLDER, matches[0])
            conv_path = os.path.join(OUTPUT_FOLDER, fid + "_conv.mp4")
            result = subprocess.run([
                FFMPEG, "-y", "-i", src,
                "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
                "-c:v", "libx264", "-profile:v", "baseline", "-level", "3.0",
                "-c:a", "aac", "-ar", "44100", "-ac", "2",
                "-movflags", "+faststart",
                conv_path
            ], capture_output=True, text=True)
            if result.returncode != 0:
                return jsonify({"error": f"FFmpeg encode failed: {result.stderr[-300:]}"}), 500
            converted.append(conv_path)

        with open(list_path, "w") as lf:
            for cp in converted:
                lf.write(f"file '{os.path.abspath(cp)}'\n")

        result = subprocess.run([
            FFMPEG, "-y", "-f", "concat", "-safe", "0",
            "-i", list_path, "-c", "copy", output_path
        ], capture_output=True, text=True)

        os.remove(list_path)
        for cp in converted:
            try:
                os.remove(cp)
            except Exception:
                pass

        if result.returncode != 0:
            return jsonify({"error": f"FFmpeg concat failed: {result.stderr[-300:]}"}), 500

        if not os.path.exists(output_path):
            return jsonify({"error": "Output file not created."}), 500

        return jsonify({"download_id": output_id})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/download/<download_id>")
def download(download_id):
    path = os.path.join(OUTPUT_FOLDER, download_id + ".mp4")
    if not os.path.exists(path):
        return "", 404

    @after_this_request
    def cleanup(response):
        try:
            os.remove(path)
        except Exception:
            pass
        return response

    return send_file(path, as_attachment=True, download_name="merged_video.mp4")


@app.route("/")
def index():
    return send_from_directory(".", "index.html")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
