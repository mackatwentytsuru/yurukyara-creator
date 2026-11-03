"""E02 face measurement toolkit. All distances are percentages of reference IOD."""
import argparse
import csv
import hashlib
import json
import math
import sys
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mpp
from mediapipe.tasks.python import vision

MODEL = Path(__file__).parent / "models" / "face_landmarker.task"
RE, LE = (33, 133, 159, 145), (263, 362, 386, 374)
SETS = {
    "eyes": [33,7,163,144,145,153,154,155,133,246,161,160,159,158,157,173,
             263,249,390,373,374,380,381,382,362,466,388,387,386,385,384,398],
    "brows": [46,53,52,65,55,70,63,105,66,107,276,283,282,295,285,300,293,334,296,336],
    "nose": [168,6,197,195,5,4,1,19,94,2,98,97,326,327,64,294,48,278,129,358,
             115,344,220,440,45,275,131,360,49,279,102,331],
    "mouth": [61,146,91,181,84,17,314,405,321,375,291,185,40,39,37,0,267,269,270,409,
              78,95,88,178,87,14,317,402,318,324,308,191,80,81,82,13,312,311,310,415],
    "outline": [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,
                152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109],
}
ALL = sorted(set(sum(SETS.values(), [])))
GEOM = ["shift_a", "shift_b", "shift_c", "scale_095", "scale_105",
        "rot_p15", "rot_m15", "half_res", "jpeg80", "blur12"]
PHOTO = ["darker", "gamma12", "desat", "warmer", "cooler"]
_DETECTOR = None


def digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1048576), b""):
            h.update(block)
    return h.hexdigest()


def write_json(path, data):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def landmarker():
    global _DETECTOR
    if _DETECTOR is None:
        if not MODEL.is_file():
            raise FileNotFoundError(f"MediaPipe model missing: {MODEL}")
        opts = vision.FaceLandmarkerOptions(
            base_options=mpp.BaseOptions(model_asset_path=str(MODEL)),
            running_mode=vision.RunningMode.IMAGE, num_faces=1,
            min_face_detection_confidence=0.2, min_face_presence_confidence=0.2,
            output_face_blendshapes=False, output_facial_transformation_matrixes=True)
        _DETECTOR = vision.FaceLandmarker.create_from_options(opts)
    return _DETECTOR


def load_bgr(path):
    p = Path(path)
    if not p.is_file():
        raise FileNotFoundError(f"Image not found: {p}")
    bgr = cv2.imread(str(p), cv2.IMREAD_COLOR)
    if bgr is None:
        raise ValueError(f"Cannot decode image: {p}")
    return bgr


def detect_bgr(bgr):
    h, w = bgr.shape[:2]
    rgb = np.ascontiguousarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
    res = landmarker().detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
    if not res.face_landmarks:
        return None
    pts = np.array([[p.x*w, p.y*h, p.z*w] for p in res.face_landmarks[0]], dtype=np.float64)
    if len(pts) != 478:
        raise ValueError(f"Expected 478 face landmarks, found {len(pts)}")
    if not res.facial_transformation_matrixes:
        raise ValueError("Facial transformation matrix missing")
    r = np.asarray(res.facial_transformation_matrixes[0], dtype=float)[:3, :3]
    pose = dict(yaw=math.degrees(math.asin(np.clip(-r[2, 0], -1, 1))),
                pitch=math.degrees(math.atan2(r[2, 1], r[2, 2])),
                roll=math.degrees(math.atan2(r[1, 0], r[0, 0])))
    return {"pts2d": pts[:, :2].tolist(), "pts3d": pts.tolist(), "pose": pose,
            "iod_px": iod(pts[:, :2])}


def detect_file(path):
    bgr = load_bgr(path)
    p = Path(path)
    meta = {"image_path": str(p.resolve()), "sha256": digest(p),
            "size": [bgr.shape[1], bgr.shape[0]], "detected": False,
            "model_sha256": digest(MODEL), "mediapipe_version": mp.__version__}
    found = detect_bgr(bgr)
    if found:
        meta.update(found)
        meta["detected"] = True
    return meta


def eye_center(p, ind):
    return np.mean(p[list(ind)], axis=0)


def iod(p):
    result = float(np.linalg.norm(eye_center(p, LE) - eye_center(p, RE)))
    if result <= 1e-9:
        raise ValueError("IOD is zero")
    return result


def ratios(p):
    cr, cl = eye_center(p, RE), eye_center(p, LE)
    unit = (cl-cr)/np.linalg.norm(cl-cr)
    down = np.array([-unit[1], unit[0]])
    mid = (cr+cl)/2
    eye_dist = iod(p)
    d = lambda a, b: float(np.linalg.norm(p[a]-p[b]))/eye_dist
    v = lambda i: float(np.dot(p[i]-mid, down))/eye_dist
    h = lambda a, b: abs(float(np.dot(p[a]-p[b], unit)))/eye_dist
    tilt = lambda t: math.degrees(math.atan2(float(np.dot(p[t[1]]-p[t[0]], down)),
                                             abs(float(np.dot(p[t[0]]-p[t[1]], unit)))))
    ew = (d(33,133)+d(263,362))/2
    eh = (d(159,145)+d(386,374))/2
    return {"eye_w": ew, "eye_h": eh, "eye_hw": eh/ew, "inner_gap": d(133,362),
            "outer_span": d(33,263), "eye_tilt_deg": (tilt(RE)+tilt(LE))/2,
            "brow_h": -(v(105)+v(334))/2, "brow_len": (d(70,107)+d(300,336))/2,
            "brow_gap": d(107,336), "nose_w": h(129,358), "nose_wing_w": h(64,294),
            "nose_len": v(2)-v(168), "mouth_w": d(61,291), "lip_up": v(13)-v(0),
            "lip_lo": v(17)-v(14), "philtrum": v(0)-v(2), "chin_len": v(152)-v(17),
            "mid_face": v(2), "lower_face": v(152)-v(2), "eye_to_chin": v(152),
            "mesh_top": -v(10), "face_w": h(234,454), "jaw_w": h(58,288),
            "jaw2_w": h(172,397), "chin_w": h(149,378)}


def similarity(a, b):
    ma, mb = a.mean(axis=0), b.mean(axis=0)
    ca, cb = a-ma, b-mb
    u, s, vt = np.linalg.svd(cb.T @ ca/len(a))
    diag = np.eye(a.shape[1])
    if np.linalg.det(u @ vt) < 0:
        diag[-1, -1] = -1
    rotation = u @ diag @ vt
    scale = float(np.trace(np.diag(s) @ diag)/(ca**2).sum(1).mean())
    return scale, rotation, mb-scale*rotation@ma


def aligned(a, b, dims=2):
    scale, rotation, translation = similarity(a[ALL, :dims], b[ALL, :dims])
    transformed = (scale*(rotation@a[:, :dims].T)).T + translation
    return transformed, rotation


def region_rms(a, b, dimension=(0,1)):
    e = iod(b[:, :2])
    return {key: float(np.sqrt(((a[idx][:,dimension]-b[idx][:,dimension])**2).sum(1).mean())/e*100)
            for key, idx in list(SETS.items())+[("all", ALL)]}


def region_distance(a, b, dims=2, residual_dims=None):
    transformed, rotation = aligned(a, b, dims)
    compare = (0,1) if residual_dims is None and dims == 2 else residual_dims
    if compare is None:
        compare = tuple(range(dims))
    table = region_rms(transformed, b[:, :dims], dimension=compare)
    angle = None
    if dims == 3:
        angle = math.degrees(math.acos(float(np.clip((np.trace(rotation)-1)/2,-1,1))))
    return table, angle


def checked_lmk(path):
    rec = read_json(path)
    if not rec.get("detected"):
        raise ValueError(f"Landmarks not detected: {path}")
    p = np.asarray(rec["pts3d"], dtype=float)
    if p.shape != (478,3) or len(rec["pts2d"]) != 478:
        raise ValueError(f"Invalid landmark shape: {path}")
    return rec, p


def do_detect(args):
    target = Path(args.out)
    target.mkdir(parents=True, exist_ok=True)
    stems = [Path(x).stem for x in args.images]
    if len(stems) != len(set(stems)):
        raise ValueError("Duplicate image stems would overwrite output; supply distinct stems")
    for image in args.images:
        dest = target/(Path(image).stem+".lmk.json")
        sha = digest(image)
        if dest.is_file():
            previous = read_json(dest)
            if previous.get("sha256") == sha and previous.get("model_sha256") == digest(MODEL):
                print(f"CACHED {image} -> {dest}")
                continue
        data = detect_file(image)
        write_json(dest, data)
        print(f"{'OK' if data['detected'] else 'NO_FACE'} {image} -> {dest}")


def do_pair(args):
    reference, ref = checked_lmk(args.ref)
    data, ratio_rows = [], []
    ref_ratios = ratios(ref[:, :2])
    ratio_rows.append({"name": Path(args.ref).name.removesuffix(".lmk.json"), "role": "reference", **ref_ratios})
    for f in args.cand:
        cand, p = checked_lmk(f)
        candidate = Path(f).name.removesuffix(".lmk.json")
        for mode in (2,3):
            dist, angle = region_distance(p, ref, mode)
            data.append({"name": candidate, "reference": Path(args.ref).name.removesuffix(".lmk.json"),
                         "mode": f"{mode}d", "pose_yaw": cand["pose"]["yaw"],
                         "reference_yaw": reference["pose"]["yaw"],
                         "pose_delta_yaw": cand["pose"]["yaw"]-reference["pose"]["yaw"],
                         "pose_delta_pitch": cand["pose"]["pitch"]-reference["pose"]["pitch"],
                         **dist, "rot3d_deg": angle if mode==3 else ""})
        m = ratios(p[:, :2])
        ratio_rows.append({"name": candidate, "role": "candidate", **m})
        ratio_rows.append({"name": candidate, "role": "percent_change",
                           **{k: (m[k]/v-1)*100 if abs(v)>1e-10 else "" for k,v in ref_ratios.items()}})
    csv_write(args.out, data)
    dest = Path(args.out)
    csv_write(dest.with_name(dest.stem+"_ratios.csv"), ratio_rows)
    print(f"OK {len(args.cand)} candidates, {len(data)} rows -> {args.out}")


def csv_write(path, rows):
    if not rows:
        raise ValueError("No CSV records")
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def perturb(img, kind):
    h, w = img.shape[:2]
    if kind.startswith("shift"):
        dx, dy = {"shift_a": (3,0), "shift_b": (0,3), "shift_c": (-4,-2)}[kind]
        return cv2.warpAffine(img, np.float32([[1,0,dx],[0,1,dy]]),(w,h),borderMode=cv2.BORDER_REPLICATE)
    if kind in ("scale_095","scale_105","rot_p15","rot_m15"):
        angle = {"rot_p15": 1.5,"rot_m15": -1.5}.get(kind,0)
        scale = {"scale_095":0.95,"scale_105":1.05}.get(kind,1)
        mat = cv2.getRotationMatrix2D((w/2,h/2), angle, scale)
        return cv2.warpAffine(img,mat,(w,h),borderMode=cv2.BORDER_REPLICATE)
    if kind=="half_res":
        small=cv2.resize(img,(w//2,h//2),interpolation=cv2.INTER_AREA)
        return cv2.resize(small,(w,h),interpolation=cv2.INTER_CUBIC)
    if kind=="jpeg80":
        ok, encoded=cv2.imencode(".jpg",img,[cv2.IMWRITE_JPEG_QUALITY,80])
        if not ok:
            raise ValueError("JPEG encode failed")
        return cv2.imdecode(encoded,cv2.IMREAD_COLOR)
    if kind=="blur12":
        return cv2.GaussianBlur(img,(0,0),1.2)
    f=img.astype(np.float32)/255
    if kind=="darker": f*=0.8
    elif kind=="gamma12": f=f**1.2
    elif kind=="desat": f=f.mean(2,keepdims=True)+0.4*(f-f.mean(2,keepdims=True))
    elif kind=="warmer": f*=np.array([0.90,1.0,1.08],np.float32)
    elif kind=="cooler": f*=np.array([1.10,1.0,0.92],np.float32)
    else: raise ValueError(f"Unknown perturbation: {kind}")
    return (np.clip(f,0,1)*255).astype(np.uint8)


def ratio_stats(samples, baseline):
    output={}
    for key, val in baseline.items():
        values=[x[key] for x in samples]+[val]
        output[key]=float(np.std(values)/abs(val)*100) if abs(val)>1e-9 else None
    return output


def do_noise(args):
    img=load_bgr(args.image)
    base=detect_bgr(img)
    if base is None:
        raise ValueError("No face detected in noise reference")
    p=np.asarray(base["pts3d"])
    baseline=ratios(p[:,:2])
    samples={}
    for kind in GEOM+PHOTO:
        result=detect_bgr(perturb(img,kind))
        if result is None:
            raise ValueError(f"No face for noise perturbation {kind}")
        q=np.asarray(result["pts3d"])
        samples[kind]={"ratios":ratios(q[:,:2]),"region_vs_base":region_distance(q[:,:2],p[:,:2])[0]}
    stats={}
    for label, group in (("geom",GEOM),("photo",PHOTO),("all",GEOM+PHOTO)):
        rr=[samples[k]["region_vs_base"] for k in group]
        stats[label]={"ratio_sd_pct":ratio_stats([samples[k]["ratios"] for k in group],baseline),
                      "regions":{k:{"mean":float(np.mean([x[k] for x in rr])),
                                    "max":float(np.max([x[k] for x in rr]))} for k in list(SETS)+["all"]}}
    write_json(args.out,{"image":str(Path(args.image).resolve()),"sha256":digest(args.image),
                         "baseline":baseline,"perturbations":samples,"stats":stats,"not_checked":[]})
    print(f"OK {len(samples)} perturbations -> {args.out}")


def do_repeat(args):
    if len(args.lmk)<2:
        raise ValueError("repeat requires >=2 shots")
    records=[checked_lmk(x) for x in args.lmk]
    data=[rec[1][:,:2] for rec in records]
    pose_spread=max(max(abs(rec[0]["pose"][axis]-records[0][0]["pose"][axis]) for axis in ("yaw","pitch"))
                    for rec in records)
    ref=data[0]
    norm=[ref]+[aligned(p,ref)[0] for p in data[1:]]
    center=np.mean(norm,axis=0)
    metrics=[region_rms(p,center) for p in norm]
    raw_ratios=[ratios(p) for p in data]
    output={"files":args.lmk,"count":len(data),
            "ratio_sd_pct":{k:float(np.std([r[k] for r in raw_ratios])/abs(np.mean([r[k] for r in raw_ratios]))*100)
                            if abs(np.mean([r[k] for r in raw_ratios]))>1e-9 else None for k in raw_ratios[0]},
            "regions_vs_mean":{k:{"mean":float(np.mean([r[k] for r in metrics])),
                                   "max":float(np.max([r[k] for r in metrics])),
                                   "sd":float(np.sqrt(((np.asarray(norm)[:,idx,:]-center[idx])**2).sum(axis=2).mean())
                                              /iod(center)*100)}
                               for k,idx in list(SETS.items())+[("all",ALL)]},
            "per_shot_regions":metrics,
            "not_checked":["Same-pose repeatability: pose spread exceeds 10 degrees"]
                          if pose_spread>10 else []}
    write_json(args.out,output)
    print(f"OK {len(data)} shots -> {args.out}")


def eye_rects(img, landmarks=None):
    h,w=img.shape[:2]
    if landmarks is not None:
        pts=np.asarray(landmarks["pts2d"],float)
        if landmarks["size"]!=[w,h]:
            raise ValueError("Landmark image dimensions differ from eye image")
        return [(tuple(pts[center].mean(axis=0)), float(np.linalg.norm(pts[out]-pts[inn])), "lmk")
                for center,out,inn in ((list(RE),33,133),(list(LE),263,362))]
    found=detect_bgr(img)
    if found:
        return eye_rects(img, {**found,"size":[w,h]})
    cascade=cv2.CascadeClassifier(cv2.data.haarcascades+"haarcascade_eye.xml")
    gray=cv2.cvtColor(img,cv2.COLOR_BGR2GRAY)
    boxes=cascade.detectMultiScale(gray,scaleFactor=1.05,minNeighbors=4,minSize=(25,15))
    boxes=sorted(boxes,key=lambda b:b[2]*b[3],reverse=True)
    accepted=[]
    for x,y,bw,bh in boxes:
        c=(x+bw/2,y+bh/2)
        if all(abs(c[0]-old[0][0])>min(bw,old[1]) for old in accepted):
            accepted.append((c,float(bw),"haar"))
        if len(accepted)==2: break
    if len(accepted)!=2:
        raise ValueError(f"Eye localisation failed: no face landmarks and {len(accepted)} Haar eyes")
    return sorted(accepted,key=lambda x:x[0][0])


def eye_measure(img, center, width, debug, prefix, lmk=None, eye_idx=None):
    h,w=img.shape[:2]
    cx,cy=center
    if width<10 or cy<width*0.2:
        raise ValueError(f"Eye box invalid: {center} width={width}")
    gray=cv2.cvtColor(img,cv2.COLOR_BGR2GRAY)
    x0,x1=max(0,int(cx-width*.58)),min(w,int(cx+width*.58))
    y0,y1=max(0,int(cy-width*.53)),min(h,int(cy+width*.35))
    patch=gray[y0:y1,x0:x1]
    if patch.size==0:
        raise ValueError("Eye patch empty")
    lid_y=float(np.asarray(lmk["pts2d"])[(RE if eye_idx==0 else LE)[2],1]) if lmk else cy-width*.2
    upper=max(0,int(lid_y-width*.45))
    lower=max(upper+1,min(h,int(lid_y-width*.15)))
    band=gray[upper:lower,x0:x1]
    if band.size==0:
        raise ValueError("Upper lid band empty")
    gradients=cv2.magnitude(cv2.Sobel(gray,cv2.CV_32F,1,0),
                            cv2.Sobel(gray,cv2.CV_32F,0,1))
    crease=float(np.mean(gradients[upper:lower,x0:x1]))
    threshold=float(np.percentile(patch,25))
    lash_top=max(0,int(lid_y-width*.35))
    lash_bottom=max(lash_top+1,min(h,int(lid_y)))
    mask=(gray[lash_top:lash_bottom,x0:x1]<threshold).astype(np.uint8)
    extent=float(mask.sum())/(width*width)
    top=max(0,int(cy-width*.35)); bottom=max(top+1,min(h,int(cy)))
    linecounts=[]
    for xx in np.linspace(x0+(x1-x0)*.25,x0+(x1-x0)*.75,9,dtype=int):
        profile=gray[top:bottom,xx].astype(float)
        sm=cv2.GaussianBlur(profile[:,None].astype(np.float32),(1,5),0)[:,0]
        dark=sm<np.percentile(patch,18)
        linecounts.append(int(np.count_nonzero(np.diff(np.r_[False,dark,False].astype(int))==1)))
    double=int(np.median(linecounts)>=2)
    debug[lash_top:lash_bottom,x0:x1,1]=np.maximum(debug[lash_top:lash_bottom,x0:x1,1],mask*200)
    cv2.rectangle(debug,(x0,upper),(x1,lower),(180,80,180),1)
    cv2.rectangle(debug,(x0,y0),(x1,y1),(255,120,0),1)
    cv2.circle(debug,(int(cx),int(cy)),3,(0,0,255),-1)
    aspect, tilt = None, None
    if lmk is not None:
        P=np.asarray(lmk["pts2d"],dtype=float)
        o,n,u,l=(RE if eye_idx==0 else LE)
        eye_width=float(np.linalg.norm(P[o]-P[n]))
        aspect=float(np.linalg.norm(P[u]-P[l])/eye_width)
        tilt=float(math.degrees(math.atan2(P[n,1]-P[o,1],abs(P[n,0]-P[o,0]))))
    return {"aspect":aspect,"canthal_tilt_deg":tilt,
            "crease_gradient":crease,"lash_extent":extent,"double_line":double,
            "dark_bands_median":float(np.median(linecounts)),"localization":prefix,
            "eye_box":[x0,y0,x1,y1]}


def iris_colour(img, lmk, eye):
    if not lmk:
        return None
    p=np.asarray(lmk["pts2d"],float)
    ids=(468,469,470,471,472) if eye==0 else (473,474,475,476,477)
    coords=p[list(ids)]
    center=coords[0]
    radius=float(np.mean(np.linalg.norm(coords[1:]-center,axis=1)))*0.85
    yy,xx=np.ogrid[:img.shape[0],:img.shape[1]]
    mask=(xx-center[0])**2+(yy-center[1])**2<=radius**2
    lab=cv2.cvtColor(img,cv2.COLOR_BGR2LAB).astype(np.float32)
    pixels=lab[mask]
    if len(pixels)<10:
        return None
    bright=pixels[:,0]
    rgb=pixels[bright>np.percentile(bright,20)]
    return np.mean(rgb,axis=0).tolist() if len(rgb) else None


def delta_e2000(lab_a,lab_b):
    if lab_a is None or lab_b is None:
        return None
    a,b=np.asarray(lab_a,float),np.asarray(lab_b,float)
    a[0]*=100/255; b[0]*=100/255
    a[1:]-=128; b[1:]-=128
    # CIEDE2000, Sharma et al. hue and chroma corrections
    l1,a1,b1=a; l2,a2,b2=b
    c1,c2=np.hypot(a1,b1),np.hypot(a2,b2)
    cbar=(c1+c2)/2; g=.5*(1-np.sqrt(cbar**7/(cbar**7+25**7)))
    a1p,a2p=(1+g)*a1,(1+g)*a2
    c1p,c2p=np.hypot(a1p,b1),np.hypot(a2p,b2)
    h1,h2=np.degrees(np.arctan2(b1,a1p))%360,np.degrees(np.arctan2(b2,a2p))%360
    dh=0 if c1p*c2p==0 else ((h2-h1+180)%360)-180
    hbar=h1+h2 if c1p*c2p==0 else (h1+h2)/2 if abs(h1-h2)<=180 else (h1+h2+360)/2%360
    T=1-.17*np.cos(np.radians(hbar-30))+.24*np.cos(np.radians(2*hbar)) \
      +.32*np.cos(np.radians(3*hbar+6))-.20*np.cos(np.radians(4*hbar-63))
    lbar=(l1+l2)/2; cpbar=(c1p+c2p)/2
    sl=1+(.015*(lbar-50)**2)/np.sqrt(20+(lbar-50)**2)
    sc=1+.045*cpbar; sh=1+.015*cpbar*T
    rt=-2*np.sqrt(cpbar**7/(cpbar**7+25**7))*np.sin(np.radians(60*np.exp(-((hbar-275)/25)**2)))
    dl=(l2-l1)/sl; dc=(c2p-c1p)/sc
    dhp=2*np.sqrt(c1p*c2p)*np.sin(np.radians(dh/2))/sh
    return float(np.sqrt(dl**2+dc**2+dhp**2+rt*dc*dhp))


def do_eyes(args):
    cand,ref=load_bgr(args.image),load_bgr(args.ref_image)
    cl=read_json(args.lmk) if args.lmk else None
    rl=read_json(args.ref_lmk) if args.ref_lmk else None
    if cl is None:
        found=detect_bgr(cand)
        if found: cl={**found,"size":[cand.shape[1],cand.shape[0]]}
    if rl is None:
        found=detect_bgr(ref)
        if found: rl={**found,"size":[ref.shape[1],ref.shape[0]]}
    debug=cand.copy()
    found=eye_rects(cand,cl)
    reference=eye_rects(ref,rl)
    output={"image":args.image,"ref_image":args.ref_image,"eyes":{},"reference_eyes":{},
            "not_checked":[]}
    for i,label in enumerate(("image_left","image_right")):
        c,w,method=found[i]; rc,rw,rm=reference[i]
        data=eye_measure(cand,c,w,debug,method,cl,i)
        refdata=eye_measure(ref,rc,rw,ref.copy(),rm,rl,i)
        data["iris_lab"]=iris_colour(cand,cl,i)
        refdata["iris_lab"]=iris_colour(ref,rl,i)
        data["iris_delta_e00"]=delta_e2000(data["iris_lab"],refdata["iris_lab"])
        if data["iris_lab"] is None: output["not_checked"].append(f"{label} iris ΔE00: missing full-face iris landmarks")
        if method!="lmk": output["not_checked"].append(f"{label} shape/tilt: no closeup landmarks")
        output["eyes"][label]=data
        output["reference_eyes"][label]=refdata
    output["indicator_mean"]=float(np.mean([v["dark_bands_median"] for v in output["eyes"].values()]))
    output["double_line_count"]=sum(v["double_line"] for v in output["eyes"].values())
    dest=Path(args.out)
    write_json(dest,output)
    png=dest.with_name(dest.stem+"_debug.png")
    if not cv2.imwrite(str(png),debug):
        raise OSError(f"Failed writing debug PNG: {png}")
    print(f"OK indicator={output['indicator_mean']:.2f} double={output['double_line_count']} -> {dest}")


def parser():
    ap=argparse.ArgumentParser(description=__doc__)
    sub=ap.add_subparsers(dest="cmd",required=True)
    d=sub.add_parser("detect");d.add_argument("--images",nargs="+",required=True);d.add_argument("--out",required=True)
    p=sub.add_parser("pair");p.add_argument("--ref",required=True);p.add_argument("--cand",nargs="+",required=True);p.add_argument("--out",required=True)
    n=sub.add_parser("noise");n.add_argument("--image",required=True);n.add_argument("--out",required=True)
    r=sub.add_parser("repeat");r.add_argument("--lmk",nargs="+",required=True);r.add_argument("--out",required=True)
    e=sub.add_parser("eyes");e.add_argument("--image",required=True);e.add_argument("--ref-image",required=True)
    e.add_argument("--out",required=True);e.add_argument("--lmk");e.add_argument("--ref-lmk")
    return ap


def main():
    args=parser().parse_args()
    try:
        {"detect":do_detect,"pair":do_pair,"noise":do_noise,
         "repeat":do_repeat,"eyes":do_eyes}[args.cmd](args)
    except (ValueError,FileNotFoundError,OSError,KeyError,IndexError) as exc:
        print(f"FAIL {args.cmd}: {exc}",file=sys.stderr)
        sys.exit(2)


if __name__=="__main__":
    main()

