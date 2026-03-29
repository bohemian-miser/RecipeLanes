"""Quick CLIP smoke test — tests image-text matching on 5 icons."""
import json, numpy as np, os, sys
from pathlib import Path
import torch
from transformers import CLIPModel, CLIPProcessor
from PIL import Image

IE_DATA = Path(__file__).parent.parent.parent / 'recipe-lanes' / 'scripts' / 'ie_data'
items = json.loads((IE_DATA / 'action-icons.json').read_text())

print("Loading CLIP...")
model = CLIPModel.from_pretrained('openai/clip-vit-base-patch32')
proc  = CLIPProcessor.from_pretrained('openai/clip-vit-base-patch32')
model.eval()
print("Loaded.\n")

# 1. Grab the first 5 items
test_items = items[:5]

# 2. Extract their descriptions to use as our "candidate" list
# CLIP will compare every image against ALL of these descriptions.
candidate_texts = [item['desc'] for item in test_items]

for item in test_items:
    iid = item['id']
    actual_desc = item['desc']
    thumb = IE_DATA / 'icons' / 'thumb' / f'{iid}.png'
    
    if not thumb.exists():
        print(f"  {iid}: no thumb, skipping")
        continue
        
    # Note: Converted to RGB. CLIP expects 3 color channels.
    img = Image.open(thumb).convert('RGB').resize((224, 224))
    
    with torch.no_grad():
        # Pass BOTH the image and our list of text descriptions to the processor
        inputs = proc(text=candidate_texts, images=img, return_tensors='pt', padding=True, truncation=True)
        outputs = model(**inputs)
        
        # logits_per_image represents the raw similarity scores between the image and all texts
        logits_per_image = outputs.logits_per_image
        
        # Apply softmax to convert those scores into percentages/probabilities
        probs = logits_per_image.softmax(dim=1).cpu().numpy()[0]
        
        # Find the text with the highest probability
        best_match_idx = np.argmax(probs)
        predicted_desc = candidate_texts[best_match_idx]
        confidence = probs[best_match_idx]
        
    print(f"ID: {iid}")
    print(f"  Actual Desc:    {actual_desc[:60]}...")
    print(f"  Predicted Desc: {predicted_desc[:60]}... ")
    print(f"  Confidence:     {confidence:.1%}")
    print("-" * 60)