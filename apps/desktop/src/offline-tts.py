import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--text', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--sid', type=int, default=0)
    args = parser.parse_args()

    import sherpa_onnx
    import numpy as np
    import soundfile as sf

    model = Path(__file__).resolve().parents[3] / '.dev' / 'offline-tts' / 'vits-icefall-zh-aishell3'
    config = sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            vits=sherpa_onnx.OfflineTtsVitsModelConfig(
                model=str(model / 'model.onnx'),
                lexicon=str(model / 'lexicon.txt'),
                tokens=str(model / 'tokens.txt'),
            ),
            num_threads=2,
            provider='cpu',
        ),
        rule_fsts=','.join(str(model / name) for name in ('phone.fst', 'date.fst', 'number.fst')),
        max_num_sentences=1,
    )
    tts = sherpa_onnx.OfflineTts(config)
    audio = tts.generate(args.text, sid=args.sid % max(1, tts.num_speakers), speed=1.0)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    samples = np.asarray(audio.samples)
    if not samples.size or not np.isfinite(samples).all():
        raise RuntimeError('generated audio is empty or invalid')
    # AISHELL3 voices can be returned at a very low level. Normalize the speech to a
    # comfortable preview loudness while keeping headroom for the final mix.
    peak = float(np.max(np.abs(samples)))
    rms = float(np.sqrt(np.mean(np.square(samples))))
    if peak > 0 and rms > 0:
        gain = min(0.9 / peak, 0.18 / rms)
        samples = np.clip(samples * gain, -0.9, 0.9)
    sf.write(str(out), samples, audio.sample_rate, subtype='PCM_16')
    print(json.dumps({'path': str(out), 'sampleRate': audio.sample_rate, 'samples': len(audio.samples)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
