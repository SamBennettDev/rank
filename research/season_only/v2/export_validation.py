"""Preserve every configuration's validation probabilities without retraining."""
import shutil
from common import OUT,CACHE

if __name__=='__main__':
    destination=OUT/'validation-predictions';destination.mkdir(exist_ok=True)
    for i in range(32):shutil.copyfile(CACHE/f'validation_{i}.npz',destination/f'{i}.npz')
    print('Exported validation probabilities for all 32 configurations')
