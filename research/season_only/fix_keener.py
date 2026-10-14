"""Correct rematch exposure in Keener and refresh only that baseline's artifacts."""
import json
import numpy as np
from scipy.special import expit
from data import load,batches,week6
from models import candidates
from build import OUT,CACHE
from prepare import YEARS
from train import read_years,primary
from evaluate import calibrate,metrics

def main():
    methods=candidates();indices=[j for j,m in enumerate(methods) if m.family=='keener']
    for yr in YEARS+[2026]:
        s=load(yr);path=CACHE/f'{yr}.npz';archive=np.load(path);data={k:archive[k] for k in archive.files};row=0
        plans=list(batches(s));cut,tr,te=week6(s);plans.append((cut,tr,te))
        for number,(cut,tr,te) in enumerate(plans):
            for j in indices:
                score=methods[j].fit(s,tr,{})
                if number==len(plans)-1:data['snapshot_scores'][:,j]=score
                if len(te):
                    h=s.games.h.iloc[te].to_numpy();a=s.games.a.iloc[te].to_numpy()
                    data['rh'][row:row+len(te),j]=score[h];data['ra'][row:row+len(te),j]=score[a]
            row+=len(te)
        np.savez_compressed(path,**data)
    selection=json.loads((OUT/'selection.json').read_text());design=json.loads((OUT/'statistical-design.json').read_text())
    tr,tx=read_years(list(range(2002,2014)));va,vx=read_years(list(range(2014,2020)))
    tm=primary(tr).to_numpy();vm=primary(va).to_numpy()
    for j in indices:
        b,mb=calibrate((tx['rh']-tx['ra'])[tm,j],tr.venue[tm].to_numpy()*tx['hfa'][tm],tr.y[tm].to_numpy(),tr.margin[tm].to_numpy())
        selection['calibration'][j]=dict(probability=b.tolist(),margin=mb.tolist())
        edge=(vx['rh']-vx['ra'])[vm,j];v=va.venue[vm].to_numpy()*vx['hfa'][vm]
        design[j]['validation']=metrics(va.y[vm],expit(b[0]*edge+b[1]*v),va.margin[vm],mb[0]*edge+mb[1]*v)
    selection['statistical_indices']['keener']=min(indices,key=lambda j:(-design[j]['validation']['accuracy'],design[j]['validation']['log_loss']))
    (OUT/'selection.json').write_text(json.dumps(selection,indent=2)+'\n');(OUT/'statistical-design.json').write_text(json.dumps(design,indent=2)+'\n')
    for yr in range(2007,2027):
        p=OUT/'rolling-models'/f'{yr}.json';obj=json.loads(p.read_text());m,x=read_years(list(range(2002,yr)));mask=primary(m).to_numpy()
        for j in indices:
            b,mb=calibrate((x['rh']-x['ra'])[mask,j],m.venue[mask].to_numpy()*x['hfa'][mask],m.y[mask].to_numpy(),m.margin[mask].to_numpy())
            obj['statistical_calibration'][j]=dict(probability=b.tolist(),margin=mb.tolist())
        p.write_text(json.dumps(obj,separators=(',',':'))+'\n')
    print('Corrected Keener rematch weights; neural inputs and predictions unchanged.',flush=True)

if __name__=='__main__':main()
