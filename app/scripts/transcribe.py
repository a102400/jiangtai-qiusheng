# -*- coding: utf-8 -*-
"""
本地离线语音转写：视频 -> 音频 -> 文本（带时间戳）

用法：
    python transcribe.py <视频路径> [模型尺寸 small/base/tiny 或本地模型目录]

输出 JSON 到 stdout：
    {"ok":true,"text":"...","duration":123.4,"language":"zh","segments":[{start,end,text}],"source":"local-whisper"}

依赖安装（只需一次）：
    pip install faster-whisper          # 离线 ASR（自带 PyAV，可不装 ffmpeg）
    # ffmpeg 可选，仅在 PyAV 解码失败时作为备用；装在 D 盘时用 FFMPEG_BIN 指定路径
"""

import sys
import json
import os
import subprocess
import shutil

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def fail(msg):
    print(json.dumps({"ok": False, "error": msg}, ensure_ascii=False))
    sys.exit(0)


def have(cmd):
    return shutil.which(cmd) is not None


def find_ffmpeg():
    """ffmpeg 不一定在 PATH 里（本项目按安装纪律放在 D 盘），逐个候选探测。"""
    for cand in [os.environ.get("FFMPEG_BIN"), "D:/Tools/ffmpeg/bin/ffmpeg.exe", "ffmpeg"]:
        if cand and (os.path.isfile(cand) or shutil.which(cand)):
            return cand
    return None


LOCAL_MODEL_ROOTS = [
    os.environ.get("WHISPER_MODEL_DIR"),
    "D:/Tools/whisper-models/Systran/faster-whisper-%s",
    "D:/Tools/whisper-models/faster-whisper-%s",
    "D:/Tools/whisper-models/%s",
]


def resolve_model(size):
    """
    把模型名解析成本地目录（命中就用离线文件），否则原样返回让 faster-whisper 自行下载。
    这样在断网环境下，只要 D 盘有模型文件就能直接跑。
    """
    # 直接就是目录的情况
    if os.path.isdir(size):
        return size, True
    for pat in LOCAL_MODEL_ROOTS:
        if not pat:
            continue
        try:
            path = pat % size if "%s" in pat else pat
        except TypeError:
            continue
        if os.path.isdir(path) and os.path.isfile(os.path.join(path, "model.bin")):
            return path, True
    return size, False


def decode_with_av(path):
    """
    用 PyAV 直接把音视频解码成 16kHz 单声道 float32 数组。
    PyAV 随 faster-whisper 一起安装，自带解码能力，
    因此这一步不需要系统里单独装 ffmpeg。
    """
    import av
    import numpy as np

    container = av.open(path)
    if not container.streams.audio:
        raise RuntimeError("这个视频里没有找到音轨")
    stream = container.streams.audio[0]

    duration = None
    if stream.duration is not None and stream.time_base is not None:
        duration = float(stream.duration * stream.time_base)

    resampler = av.audio.resampler.AudioResampler(format="s16", layout="mono", rate=16000)
    chunks = []
    for frame in container.decode(stream):
        for resampled in resampler.resample(frame):
            chunks.append(resampled.to_ndarray())
    if not chunks:
        raise RuntimeError("音轨为空，无法解码")

    pcm = np.concatenate(chunks, axis=1).astype(np.float32).flatten() / 32768.0
    by_samples = round(float(pcm.shape[0]) / 16000.0, 2)
    return pcm, (round(duration, 2) if duration else by_samples)


def main():
    if len(sys.argv) < 2:
        fail("缺少视频路径参数")
    video = sys.argv[1]
    model_size = sys.argv[2] if len(sys.argv) > 2 else "small"

    if not os.path.exists(video):
        fail("视频文件不存在：" + video)

    # 1. 解码音频：优先用 PyAV（不依赖系统 ffmpeg），失败才回退 ffmpeg 命令
    audio_data = None
    audio_file = None
    try:
        audio_data, _ = decode_with_av(video)
    except Exception as av_err:
        ffmpeg_bin = find_ffmpeg()
        if not ffmpeg_bin:
            fail("音频解码失败，且未检测到 ffmpeg 作为备用方案：" + str(av_err))
        audio_file = os.path.splitext(video)[0] + "_audio.wav"
        try:
            subprocess.run(
                [ffmpeg_bin, "-y", "-i", video, "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", audio_file],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=300,
            )
        except Exception as e:
            fail("音频抽取失败：" + str(e))

    # 2. 加载模型并转写
    try:
        from faster_whisper import WhisperModel
    except Exception:
        fail("未安装 faster-whisper，请执行：pip install faster-whisper")

    try:
        model_path, offline = resolve_model(model_size)
        model = WhisperModel(model_path, device="cpu", compute_type="int8")
        source = audio_data if audio_data is not None else audio_file
        segments, info = model.transcribe(source, vad_filter=True, language="zh")
        seg_list = []
        text_parts = []
        for s in segments:
            seg_list.append({"start": round(float(s.start), 2), "end": round(float(s.end), 2), "text": s.text})
            text_parts.append(s.text)
        print(json.dumps({
            "ok": True,
            "text": "".join(text_parts).strip(),
            "duration": round(float(info.duration), 2),
            "language": info.language,
            "segments": seg_list,
            "source": "local-whisper" + ("-offline" if offline else ""),
            "model": model_path,
        }, ensure_ascii=False))
    except Exception as e:
        fail("转写失败：" + str(e))
    finally:
        try:
            if audio_file and os.path.exists(audio_file):
                os.remove(audio_file)
        except Exception:
            pass


if __name__ == "__main__":
    main()
