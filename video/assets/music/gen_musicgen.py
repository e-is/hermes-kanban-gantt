import numpy as np
import scipy.io.wavfile
import torch
from transformers import AutoProcessor, MusicgenForConditionalGeneration

PROMPT = (
    "minimal editorial electronic underscore, warm analog synth pad, "
    "soft muted kick, light shaker, 118 bpm, instrumental, calm, restrained, "
    "modern tech product film, no vocals, no big drop"
)

print("loading model...", flush=True)
processor = AutoProcessor.from_pretrained("facebook/musicgen-small")
model = MusicgenForConditionalGeneration.from_pretrained("facebook/musicgen-small")
model.eval()
print("model ready", flush=True)

inputs = processor(text=[PROMPT], padding=True, return_tensors="pt")
with torch.no_grad():
    audio = model.generate(
        **inputs,
        do_sample=True,
        guidance_scale=3.0,
        temperature=0.9,
        max_new_tokens=1500,  # ~30 s at 50 tokens/s
    )

wav = audio[0, 0].float().numpy()
wav = wav / max(1e-6, np.abs(wav).max()) * 0.9
scipy.io.wavfile.write("musicgen-raw.wav", rate=32000, data=(wav * 32767).astype(np.int16))
print("wrote musicgen-raw.wav", len(wav) / 32000.0, "s", flush=True)
