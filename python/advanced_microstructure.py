import sys
sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

import os
import glob
import numpy as np
import pandas as pd
import warnings
from PIL import Image
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import matplotlib.cm as cm

from orix import io
from orix.quaternion import Orientation, Symmetry
from orix.vector import Vector3d
from orix.plot import IPFColorKeyTSL

import scipy.sparse as sp
from scipy.sparse.csgraph import connected_components
from scipy.ndimage import median_filter, binary_dilation
from skimage.filters import threshold_otsu
from skimage.measure import regionprops
import json

warnings.filterwarnings('ignore')

def process_advanced_wc(file_path, output_dir, co_wt=None):
    base_name = os.path.splitext(os.path.basename(file_path))[0]
    print(f"\n[Advanced Microstructure] Processing: {base_name}")
    print("- 데이터 불러오는 중...")
    
    # 1. Load Data
    try:
        xmap = io.load(file_path)
        df = pd.read_csv(file_path, sep=r'\s+', comment='#', header=None, engine='python')
        iq_raw = df[5].values
        ci_raw = df[6].values
        phase_raw = df[7].values
    except Exception as e:
        print(f"Error loading {file_path}: {e}")
        return None
        
    # Grid check & conversion
    rows_orig, cols_orig = xmap.shape if xmap.ndim == 2 else (0, 0)
    expected_size = rows_orig * cols_orig
    xstep = 0.05
    with open(file_path, 'r') as f:
        for line in f:
            if 'XSTEP' in line.upper():
                xstep = float(line.split(':')[1].strip())
                break
                
    if xmap.size != expected_size:
        print("- Hexagonal Grid Detected! Converting to Square Grid...")
        from scipy.spatial import cKDTree
        xi = np.linspace(xmap.x.min(), xmap.x.max(), cols_orig)
        yi = np.linspace(xmap.y.min(), xmap.y.max(), int(cols_orig * (xmap.y.max()-xmap.y.min())/(xmap.x.max()-xmap.x.min())))
        X, Y = np.meshgrid(xi, yi); rows, cols = X.shape; num_pixels = rows * cols
        dist, idx = cKDTree(np.c_[xmap.x, xmap.y]).query(np.c_[X.ravel(), Y.ravel()], k=1)
        valid_scan_mask = (dist <= xstep * 1.5).reshape(rows, cols)
        raw_phases_2d = phase_raw[idx].reshape(rows, cols)
        raw_iq_2d = iq_raw[idx].reshape(rows, cols)
        ci_map = ci_raw[idx].reshape(rows, cols)
        rotations_map = xmap.rotations.data[idx].reshape(rows, cols, 4)
    else:
        rows, cols = rows_orig, cols_orig; num_pixels = rows * cols
        raw_phases_2d = phase_raw.reshape(rows, cols); raw_iq_2d = iq_raw.reshape(rows, cols)
        ci_map = ci_raw.reshape(rows, cols); rotations_map = xmap.rotations.reshape(rows, cols).data
        valid_scan_mask = np.ones((rows, cols), dtype=bool)

    print("- 전처리 및 위상 재정의 중...")
    smoothed_iq_2d = median_filter(raw_iq_2d, size=3)
    
    # Thresholding logic
    try:
        iq_flat = smoothed_iq_2d.ravel(); phase_flat = raw_phases_2d.ravel()
        if co_wt is not None and co_wt != -1:
            total_pixels = len(iq_flat); v_gamma = np.sum(phase_flat == 3) / total_pixels
            wc_wt = 100.0 - co_wt; vol_ratio_co = (co_wt / 8.9) / ((co_wt/8.9) + (wc_wt/15.63))
            target_frac = vol_ratio_co * (1.0 - v_gamma)
            iq_t1 = np.percentile(iq_flat[phase_flat != 3], min(max(target_frac*100, 0), 100))
        else:
            iq_t1 = threshold_otsu(iq_flat)
        phases = raw_phases_2d.copy(); phases[raw_phases_2d != 3] = 1; phases[(smoothed_iq_2d <= iq_t1) & (raw_phases_2d != 3)] = 2
    except: phases = raw_phases_2d
    
    mask_wc = (phases == 1) & (ci_map >= 0.1)
    try:
        raw_sym = xmap.phases[1].point_group
        xmap_symmetry = Symmetry(raw_sym) if isinstance(raw_sym, str) else raw_sym
    except: xmap_symmetry = Symmetry('6/mmm')
        
    ori_wc = Orientation(rotations_map, symmetry=xmap_symmetry)
    
    # Grain Identification
    print("- WC 결정 입자 분석 중...")
    ang_thresh = np.deg2rad(5.0)
    angle_right = ori_wc[:, :-1].angle_with(ori_wc[:, 1:])
    valid_right = (mask_wc[:, :-1] & mask_wc[:, 1:]) & (angle_right <= ang_thresh)
    angle_bottom = ori_wc[:-1, :].angle_with(ori_wc[1:, :])
    valid_bottom = (mask_wc[:-1, :] & mask_wc[1:, :]) & (angle_bottom <= ang_thresh)
    
    y, x = np.meshgrid(np.arange(rows), np.arange(cols), indexing='ij'); node_indices = y * cols + x
    edges_p1 = np.concatenate([node_indices[:, :-1][valid_right], node_indices[:-1, :][valid_bottom]])
    edges_p2 = np.concatenate([node_indices[:, 1:][valid_right], node_indices[1:, :][valid_bottom]])
    
    adj = sp.coo_matrix((np.ones(len(edges_p1), dtype=bool), (edges_p1, edges_p2)), shape=(num_pixels, num_pixels))
    _, labels = connected_components(csgraph=adj, directed=False)
    wc_grain_ids = labels.reshape(rows, cols); wc_grain_ids[~mask_wc] = -1
    
    # D-Metrics helper
    def calculate_d_metrics(diams, areas):
        if len(diams) == 0: return 0.0, 0.0, 0.0
        diams = np.array(diams); areas = np.array(areas)
        sort_idx = np.argsort(diams)
        d_s = diams[sort_idx]; a_s = areas[sort_idx]
        cum_a = np.cumsum(a_s); total_a = cum_a[-1]
        if total_a == 0: return 0.0, 0.0, 0.0
        p = cum_a / total_a
        return np.interp(0.1, p, d_s), np.interp(0.5, p, d_s), np.interp(0.9, p, d_s)

    # Aggressive Edge Exclusion (10px Margin)
    print("- 외곽 입자 제외 처리 중...")
    temp_labels = wc_grain_ids + 2; temp_labels[~mask_wc] = 0
    margin = 10; kill_zone = np.zeros((rows, cols), dtype=bool)
    kill_zone[:margin, :] = kill_zone[-margin:, :] = kill_zone[:, :margin] = kill_zone[:, -margin:] = True
    kill_zone |= binary_dilation(~valid_scan_mask, iterations=margin)
    for g_id in np.unique(temp_labels[kill_zone & (temp_labels > 0)]): temp_labels[temp_labels == g_id] = 0
                
    props = regionprops(temp_labels)
    el_list = [p.major_axis_length / p.minor_axis_length for p in props if p.area >= 5 and p.minor_axis_length > 0]
    circ_list = [(4.0 * np.pi * p.area) / (p.perimeter ** 2) for p in props if p.area >= 5 and p.perimeter > 0]
    
    # Grain size metrics
    gs_list = [2.0 * np.sqrt((p.area * xstep**2) / np.pi) for p in props if p.area >= 5]
    gs_areas = [p.area for p in props if p.area >= 5]
    gs_mean_a = np.sum(np.array(gs_list) * np.array(gs_areas)) / np.sum(gs_areas) if gs_areas else 0
    d10, d50, d90 = calculate_d_metrics(gs_list, gs_areas)
            
    # Sigma 2
    dw_r = (wc_grain_ids[:, :-1] != wc_grain_ids[:, 1:]) & mask_wc[:, :-1] & mask_wc[:, 1:]
    dw_b = (wc_grain_ids[:-1, :] != wc_grain_ids[1:, :]) & mask_wc[:-1, :] & mask_wc[1:, :]
    all_angles = np.concatenate([angle_right[dw_r], angle_bottom[dw_b]])
    s2_frac = (np.sum((all_angles >= np.deg2rad(88.0)) & (all_angles <= np.deg2rad(91.0)))/len(all_angles))*100 if len(all_angles)>0 else 0.0

    # Visualization & MRD Quantification
    print("- 고해상도 이미지 및 MRD 정량화 생성 중...")
    
    # Maps
    ck = IPFColorKeyTSL(xmap_symmetry, direction=Vector3d.zvector()); rgb_map = ck.orientation2color(ori_wc)
    ipf_img = np.ones((rows, cols, 3)); ipf_img[mask_wc] = rgb_map[mask_wc]
    plt.imsave(os.path.join(output_dir, f"ADV_01_IPF_MAP_{base_name}.png"), ipf_img, dpi=300)
    
    el_map = np.ones((rows, cols, 3)); cmap_el = cm.get_cmap('plasma')
    for p in props: 
        if p.area >= 5 and p.minor_axis_length > 0:
            el_map[p.coords[:,0], p.coords[:,1]] = cmap_el(min(max((p.major_axis_length/p.minor_axis_length - 1.0)/2.0, 0), 1))[:3]
    plt.imsave(os.path.join(output_dir, f"ADV_02_Ellipticity_MAP_{base_name}.png"), el_map)

    sig_map = np.ones((rows, cols, 3)); sig_map[mask_wc] = [0.9, 0.9, 0.9]
    is_s2_r = dw_r.copy(); is_s2_r[is_s2_r] = (angle_right[dw_r] >= np.deg2rad(88.0)) & (angle_right[dw_r] <= np.deg2rad(91.0))
    is_s2_b = dw_b.copy(); is_s2_b[is_s2_b] = (angle_bottom[dw_b] >= np.deg2rad(88.0)) & (angle_bottom[dw_b] <= np.deg2rad(91.0))
    f_s2 = np.zeros((rows, cols), dtype=bool); f_s2[:, :-1] |= is_s2_r; f_s2[:-1, :] |= is_s2_b
    sig_map[f_s2] = [1.0, 0.0, 0.0]
    plt.imsave(os.path.join(output_dir, f"ADV_03_Sigma2_MAP_{base_name}.png"), sig_map)

    # ── MRD (Multiples of Random Distribution) ────────────────────────────
    # orix의 pole_density_function 반환값은 렌더링용 0~1 정규화 객체임.
    # 진짜 MRD = 샘플밀도 / 균일분포밀도 → scipy KDE로 직접 계산
    from scipy.stats import gaussian_kde

    def calc_mrd_max(vectors_xyz, sigma_deg=7.5, max_samples=5000):
        """구형 KDE 기반 Max MRD 계산. 속도를 위해 최대 max_samples개 샘플링."""
        if len(vectors_xyz) < 10:
            return 1.0
        # 랜덤 서브샘플링 (KDE는 대표 샘플로도 충분히 정확)
        if len(vectors_xyz) > max_samples:
            idx = np.random.choice(len(vectors_xyz), max_samples, replace=False)
            vectors_xyz = vectors_xyz[idx]
        bw = np.deg2rad(sigma_deg)
        kde = gaussian_kde(vectors_xyz.T, bw_method=bw)
        # 구면 샘플 그리드
        phi = np.linspace(0, 2*np.pi, 72)
        theta = np.linspace(0.01, np.pi-0.01, 36)
        PP, TT = np.meshgrid(phi, theta)
        pts = np.array([np.sin(TT)*np.cos(PP), np.sin(TT)*np.sin(PP), np.cos(TT)]).reshape(3, -1)
        density = kde(pts)
        mean_d = np.mean(density)
        return float((density / mean_d).max()) if mean_d > 1e-12 else 1.0

    max_mrd_ipf, max_pf, t_idx = 1.0, [1.0, 1.0, 1.0], 1.0
    sigma_deg = 7.5

    try:
        # IPF Z: crystal [0001] → sample Z
        c_dirs_xyz = ((~ori_wc[mask_wc]) * Vector3d.zvector()).unit.data
        max_mrd_ipf = calc_mrd_max(c_dirs_xyz, sigma_deg)

        # Pole Figures: [0001], [2-1-10], [10-10]
        crystal_axes = [Vector3d([0,0,1]), Vector3d([2,-1,-1,0]).unit if False else Vector3d([1,0,0]), Vector3d([0,1,0])]
        # WC hexagonal: Basal=[0001], Prismatic1=[2-1-10]=[1,0,0] approx, Prismatic2=[10-10]=[0,1,0] approx
        pf_dirs_list = [
            (ori_wc[mask_wc] * Vector3d([0,0,1])).unit.data,
            (ori_wc[mask_wc] * Vector3d([1,0,0])).unit.data,
            (ori_wc[mask_wc] * Vector3d([0,1,0])).unit.data,
        ]
        for i, pf_xyz in enumerate(pf_dirs_list):
            max_pf[i] = calc_mrd_max(pf_xyz, sigma_deg)
    except Exception as e:
        print(f"MRD Calc Error: {e}")

    # ── 시각화 (orix로 그림만, 수치는 위에서 계산) ─────────────────────────────
    try:
        c_dirs = (~ori_wc[mask_wc]) * Vector3d.zvector()

        # IPF Z Density Map
        fig_ipf = plt.figure(figsize=(10, 8), dpi=300)
        ax_ipf = fig_ipf.add_subplot(111, projection='ipf', symmetry=xmap_symmetry)
        p_dens = ax_ipf.pole_density_function(c_dirs, sigma=sigma_deg)
        ax_ipf.set_title(f"IPF Z Texture Density (Max MRD: {max_mrd_ipf:.2f})", fontweight='bold')
        fig_ipf.colorbar(p_dens, ax=ax_ipf, fraction=0.046, pad=0.04)
        plt.tight_layout()
        plt.savefig(os.path.join(output_dir, f"ADV_00_IPF_Texture_Density_{base_name}.png"), dpi=300)
        plt.close()

        # Pole Figures
        fig_pf = plt.figure(figsize=(24, 8), dpi=300)
        for i, (cdir, title) in enumerate(zip([Vector3d.zvector(), Vector3d.xvector(), Vector3d.yvector()],
                                               ["[0001] Basal PF", "[2-1-10] Prismatic PF", "[10-10] Prismatic PF"])):
            ax_p = fig_pf.add_subplot(1, 3, i+1, projection='stereographic')
            p_obj = ax_p.pole_density_function(ori_wc[mask_wc] * cdir, sigma=sigma_deg)
            ax_p.set_title(f"{title}\n(Max MRD: {max_pf[i]:.2f})", fontweight='bold', fontsize=16)
            fig_pf.colorbar(p_obj, ax=ax_p, fraction=0.046, pad=0.04)
        plt.tight_layout(pad=6.0)
        plt.savefig(os.path.join(output_dir, f"ADV_00_Pole_Figure_{base_name}.png"), dpi=300)
        plt.close()
    except Exception as e:
        print(f"Map Error: {e}")


    # Graphs
    def save_dist(data, bins, range, title, xlabel, color, out_path, highlight=None):
        fig, ax = plt.subplots(figsize=(10, 6), dpi=300); c, b = np.histogram(data, bins=bins, range=range); bc = 0.5*(b[:-1]+b[1:])
        ax.plot(bc, c, color=color, marker='o', markersize=4, linewidth=1.5)
        if highlight: ax.axvspan(highlight[0], highlight[1], color='red', alpha=0.2)
        ax.set_title(title, fontweight='bold'); ax.set_xlabel(xlabel); ax.set_ylabel('Frequency'); ax.grid(True, alpha=0.3)
        plt.tight_layout(); plt.savefig(out_path, dpi=300); plt.close()

    save_dist(np.rad2deg(all_angles), 90, (5, 95), f'Sigma-2 Distribution ({s2_frac:.2f}%)', 'Misorientation (Deg)', 'black', os.path.join(output_dir, f"ADV_04_Sigma2_Graph_{base_name}.png"), (88, 91))
    if el_list: save_dist(el_list, 50, (1, 4), 'Ellipticity Distribution', 'Aspect Ratio', 'blue', os.path.join(output_dir, f"ADV_05_Ellipticity_Graph_{base_name}.png"))
    if circ_list: save_dist(circ_list, 50, (0, 1), 'Circularity Distribution', 'Circularity', 'green', os.path.join(output_dir, f"ADV_06_Circularity_Graph_{base_name}.png"))

    try:
        crystal_z = (~ori_wc[mask_wc]) * Vector3d.zvector(); z_angs = np.rad2deg(Vector3d([0,0,1]).angle_with(crystal_z))
        save_dist(z_angs, 90, (0, 90), 'Z-Axis Orientation Distribution', 'Angle from [0001] (Deg)', 'purple', os.path.join(output_dir, f"ADV_07_Z_Orientation_Graph_{base_name}.png"))
    except: pass

    rgb_wc = rgb_map[mask_wc]; rgb_sum = len(rgb_wc)
    is_r = (rgb_wc[:,0] >= rgb_wc[:,1]) & (rgb_wc[:,0] >= rgb_wc[:,2])
    is_g = (rgb_wc[:,1] > rgb_wc[:,0]) & (rgb_wc[:,1] >= rgb_wc[:,2])
    is_b = (rgb_wc[:,2] > rgb_wc[:,0]) & (rgb_wc[:,2] > rgb_wc[:,1])

    return {
        "Filename": base_name, "Grains": len(el_list), "S2": s2_frac,
        "GS_Mean_A": gs_mean_a, "D10": d10, "D50": d50, "D90": d90,
        "El": np.mean(el_list) if el_list else 0, "El_Std": np.std(el_list) if el_list else 0,
        "Ci": np.mean(circ_list) if circ_list else 0, "Ci_Std": np.std(circ_list) if circ_list else 0,
        "A_R": (np.sum(is_r)/rgb_sum)*100 if rgb_sum>0 else 0,
        "A_G": (np.sum(is_g)/rgb_sum)*100 if rgb_sum>0 else 0,
        "A_B": (np.sum(is_b)/rgb_sum)*100 if rgb_sum>0 else 0,
        "Mud_IPF": max_mrd_ipf, "T_Idx": t_idx, "Mud_P1": max_pf[0], "Mud_P2": max_pf[1], "Mud_P3": max_pf[2]
    }

if __name__ == "__main__":
    search_dir, co_wt, co_map = None, None, None
    i = 1
    while i < len(sys.argv):
        if sys.argv[i] == "--uploaded": search_dir = sys.argv[i+1]; i += 2
        elif sys.argv[i] == "--co-wt": co_wt = float(sys.argv[i+1]); i += 2
        elif sys.argv[i] == "--comp-map": co_map = json.loads(sys.argv[i+1]); i += 2
        else: search_dir = sys.argv[i]; i += 1
    
    if search_dir:
        files = glob.glob(os.path.join(search_dir, "*.ang"))
        all_rep = []
        for f in files:
            if f.endswith("_square.ang"): continue
            target_wt = co_map.get(os.path.basename(f), co_wt) if co_map else co_wt
            r = process_advanced_wc(f, search_dir, co_wt=target_wt)
            if r: all_rep.append(r)
        
        with open(os.path.join(search_dir, "Advanced_WC_Microstructure_Report.txt"), 'w', encoding='utf-8') as f:
            for r in all_rep:
                f.write(f"▶ 파일명: {r['Filename']}\n   [집합조직 정량화 - MRD]\n")
                f.write(f"     - IPF Z Density Max: {r['Mud_IPF']:.2f} (Index: {r['T_Idx']:.2f})\n")
                f.write(f"     - [0001] Basal PF Max: {r['Mud_P1']:.2f}\n")
                f.write(f"     - [2-1-10] Prismatic PF Max: {r['Mud_P2']:.2f}\n")
                f.write(f"     - [10-10] Prismatic PF Max: {r['Mud_P3']:.2f}\n\n")
                f.write(f"   [결정방위 비율 (Area%)]\n     - Red [0001]: {r['A_R']:.2f}%\n     - Green [11-20]: {r['A_G']:.2f}%\n     - Blue [10-10]: {r['A_B']:.2f}%\n")
                f.write(f"   [형태학적 특성 - 외곽 제외]\n     분석 입자수: {r['Grains']}개\n")
                f.write(f"     WC 평균입도(Area-Weighted): {r['GS_Mean_A']:.4f} μm\n")
                f.write(f"     WC D10: {r['D10']:.4f} μm, D50: {r['D50']:.4f} μm, D90: {r['D90']:.4f} μm\n")
                f.write(f"     평균 Ellipticity: {r['El']:.4f} (±{r['El_Std']:.4f})\n     평균 Circularity: {r['Ci']:.4f} (±{r['Ci_Std']:.4f})\n")
                f.write(f"   [특이 입계 특성]\n     Sigma-2 (89.5°±1.5°): {r['S2']:.2f}%\n" + "-"*60 + "\n")
        
        images = [os.path.basename(i) for i in glob.glob(os.path.join(search_dir, "ADV_*.png"))]
        images.sort()
        json_str = json.dumps({"type": "result_pack", "txt": "Advanced_WC_Microstructure_Report.txt", "images": images}, separators=(',', ':'))
        print(f'JSON_DATA:{json_str}', flush=True); import time; time.sleep(0.5)
