import sys
sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

import os
import glob
import numpy as np
import pandas as pd
import warnings
import json
from PIL import Image
from orix import io
from orix.quaternion import Orientation
import scipy.sparse as sp
from scipy.sparse.csgraph import connected_components
from scipy.ndimage import distance_transform_edt, median_filter
from skimage.filters import threshold_otsu
import tkinter as tk
from tkinter import filedialog
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches

warnings.filterwarnings('ignore')

def process_combined_microstructure(file_path, output_dir, co_wt=None):
    base_name = os.path.splitext(os.path.basename(file_path))[0]
    print(f"\n[Microstructure Analysis] Processing: {base_name}", flush=True)
    
    try:
        xmap = io.load(file_path)
        df = pd.read_csv(file_path, sep=r'\s+', comment='#', header=None, engine='python')
        iq_raw = df[5].values
        ci_raw = df[6].values
        phase_raw = df[7].values
    except Exception as e:
        print(f"Error loading {file_path}: {e}")
        return None
        
    # Grid handling
    xstep = 0.05
    with open(file_path, 'r') as f:
        for line in f:
            if 'XSTEP' in line.upper():
                xstep = float(line.split(':')[1].strip())
                break
                
    expected_size = xmap.shape[0] * xmap.shape[1]
    
    if xmap.size != expected_size:
        print("- Hexagonal Grid Detected! Converting to Square Grid...", flush=True)
        x_min, x_max = xmap.x.min(), xmap.x.max()
        y_min, y_max = xmap.y.min(), xmap.y.max()
        xi = np.arange(x_min, x_max + xstep * 0.5, xstep)
        yi = np.arange(y_min, y_max + xstep * 0.5, xstep)
        X, Y = np.meshgrid(xi, yi)
        rows, cols = X.shape
        num_pixels = rows * cols
        from scipy.spatial import cKDTree
        tree = cKDTree(np.c_[xmap.x, xmap.y])
        dist, idx = tree.query(np.c_[X.ravel(), Y.ravel()], k=1)
        raw_phases_2d = phase_raw[idx].reshape(rows, cols)
        raw_iq_2d = iq_raw[idx].reshape(rows, cols)
        ci_map = ci_raw[idx].reshape(rows, cols)
        rotations_map = xmap.rotations.data[idx].reshape(rows, cols, 4)
    else:
        rows, cols = xmap.shape
        num_pixels = rows * cols
        raw_phases_2d = phase_raw.reshape(rows, cols)
        raw_iq_2d = iq_raw.reshape(rows, cols)
        ci_map = ci_raw.reshape(rows, cols)
        rotations_map = xmap.rotations.reshape(rows, cols).data

    smoothed_iq_2d = median_filter(raw_iq_2d, size=3)
    
    # 2. Thresholding
    try:
        iq_flat = smoothed_iq_2d.ravel()
        phase_flat = raw_phases_2d.ravel()
        total_pixels = len(iq_flat)
        v_gamma_detected = (np.sum(phase_flat == 3) / total_pixels) if total_pixels > 0 else 0
        
        if co_wt is not None and co_wt != -1:
            wc_wt = max(0, 100.0 - co_wt)
            vol_co = co_wt / 8.9
            vol_wc = wc_wt / 15.63
            vol_ratio_co = vol_co / (vol_co + vol_wc) if (vol_co + vol_wc) > 0 else 0
            true_co_vol_frac = vol_ratio_co * (1.0 - v_gamma_detected)
            target_co_pixels = int(total_pixels * true_co_vol_frac)
            mask_non_gamma = (phase_flat != 3)
            iq_non_gamma = iq_flat[mask_non_gamma]
            percentile = (target_co_pixels / len(iq_non_gamma)) * 100.0 if np.any(mask_non_gamma) else 0
            iq_t1 = np.percentile(iq_non_gamma, min(max(percentile, 0), 100))
        else:
            iq_t1 = threshold_otsu(iq_flat)
        
        phase_redefined_2d = raw_phases_2d.copy()
        phase_redefined_2d[raw_phases_2d != 3] = 1
        phase_redefined_2d[(smoothed_iq_2d <= iq_t1) & (raw_phases_2d != 3)] = 2
        phases = phase_redefined_2d
        
        # --- Threshold Verification Plot (Reference Lines) ---
        print("- Generating Threshold Verification Plot...", flush=True)
        from skimage.filters import threshold_multiotsu
        from scipy.ndimage import gaussian_filter1d
        from scipy.signal import find_peaks
        
        # Calculate reference thresholds (for display only, not applied)
        otsu_t = threshold_otsu(iq_flat)
        try:
            multi_otsu_vals = threshold_multiotsu(iq_flat, classes=3)
        except Exception:
            multi_otsu_vals = [otsu_t]
        
        # Valley detection
        hist_vals, bin_edges = np.histogram(iq_flat, bins=256)
        smoothed = gaussian_filter1d(hist_vals.astype(float), sigma=2.0)
        bin_centers = (bin_edges[:-1] + bin_edges[1:]) / 2
        peaks, _ = find_peaks(smoothed, prominence=np.max(smoothed) * 0.05)
        valley_t = None
        if len(peaks) >= 2:
            sorted_peaks = peaks[np.argsort(smoothed[peaks])][-2:]
            p1, p2 = np.sort(sorted_peaks)
            v_idx = np.argmin(smoothed[p1:p2]) + p1
            valley_t = float(bin_centers[v_idx])
        
        fig, ax = plt.subplots(figsize=(12, 6))
        ax.hist(iq_flat, bins=256, color='skyblue', alpha=0.45, label='IQ Distribution (Smoothed)')
        ax.plot(bin_centers, smoothed, color='steelblue', linewidth=1.5, alpha=0.8, label='Smoothed Trend')
        
        # Reference lines (참고용)
        ax.axvline(otsu_t, color='black', linestyle='--', linewidth=1.5, label=f'Otsu: {otsu_t:.1f}')
        for j, mv in enumerate(multi_otsu_vals):
            lbl = f'Multi-Otsu T{j+1}: {mv:.1f}' if j == 0 else f'Multi-Otsu T{j+1}: {mv:.1f}'
            ax.axvline(mv, color='orange', linestyle='--', linewidth=1.5, label=lbl)
        if valley_t is not None:
            ax.axvline(valley_t, color='blue', linestyle='--', linewidth=1.5, label=f'Valley: {valley_t:.1f}')
        
        # Actually applied threshold (실제 적용값)
        ax.axvline(iq_t1, color='red', linestyle='-', linewidth=2.5, label=f'✔ Applied: {iq_t1:.1f}')
        
        ax.set_title(f"Threshold Verification - {base_name}\n(점선=참고용, 빨간 실선=실제 적용값)", fontsize=12)
        ax.set_xlabel("Image Quality (IQ)")
        ax.set_ylabel("Frequency")
        ax.legend(loc='upper right', fontsize=9)
        plt.tight_layout()
        plt.savefig(os.path.join(output_dir, f"threshold_check_{base_name}.png"), dpi=150)
        plt.close()
        
    except Exception as e:
        print(f"Warning: {e}"); phases = raw_phases_2d

    # 3. Grain Segmentation (Original Logic)
    angle_threshold_rad = np.deg2rad(5.0)
    global_grain_ids = np.full((rows, cols), -1, dtype=np.int32)
    next_grain_id = 0
    
    for p_id in np.unique(phases):
        mask = (phases == p_id) & (ci_map >= 0.1)
        if not np.any(mask): continue
        try: symmetry = xmap.phases[int(p_id)].point_group
        except: symmetry = '6/mmm'
        ori_2d = Orientation(rotations_map, symmetry=symmetry)
        y, x = np.meshgrid(np.arange(rows), np.arange(cols), indexing='ij')
        node_indices = y * cols + x
        
        if int(p_id) == 2: # Co Binder: Ignore misorientation
            valid_right = (mask[:, :-1] & mask[:, 1:])
            valid_bottom = (mask[:-1, :] & mask[1:, :])
        else:
            angle_right = ori_2d[:, :-1].angle_with(ori_2d[:, 1:])
            valid_right = (mask[:, :-1] & mask[:, 1:]) & (angle_right <= angle_threshold_rad)
            angle_bottom = ori_2d[:-1, :].angle_with(ori_2d[1:, :])
            valid_bottom = (mask[:-1, :] & mask[1:, :]) & (angle_bottom <= angle_threshold_rad)
        
        e1 = np.concatenate([node_indices[:, :-1][valid_right], node_indices[:-1, :][valid_bottom]])
        e2 = np.concatenate([node_indices[:, 1:][valid_right], node_indices[1:, :][valid_bottom]])
        adj = sp.coo_matrix((np.ones(len(e1), dtype=bool), (e1, e2)), shape=(num_pixels, num_pixels))
        n_c, lbls = connected_components(csgraph=adj, directed=False)
        global_grain_ids[mask] = lbls.reshape(rows, cols)[mask] + next_grain_id
        next_grain_id += n_c

    # 4. Anti-Grain & Dilation (Binder Protection Logic)
    unique_labels, counts = np.unique(global_grain_ids, return_counts=True)
    valid_labels = unique_labels[(unique_labels != -1) & (counts >= 2)]
    valid_mask = np.isin(global_grain_ids, valid_labels)
    
    # ★ 핵심: Co(Phase 2)는 입자 크기가 작아도 노이즈로 취급하지 않고 보호함
    # Co 픽셀은 valid_mask에 강제로 포함시켜서 다른 입자에 흡수되지 않게 방어
    protected_mask = valid_mask | (phases == 2)
    
    _, index_map = distance_transform_edt(~protected_mask, return_indices=True)
    dilated_grain_ids = global_grain_ids[index_map[0], index_map[1]]
    
    # Phase Map 복구: 보호된 Co는 그대로 유지, 나머지만 인접 단계로 보간
    dilated_phases = phases.copy()
    to_fill_mask = ~protected_mask
    dilated_phases[to_fill_mask] = phases[index_map[0], index_map[1]][to_fill_mask]

    
    # 5. Boundary & Contiguity (Original N_11/N_12 Logic)
    gb_right = (dilated_grain_ids[:, :-1] != dilated_grain_ids[:, 1:]) 
    gb_bottom = (dilated_grain_ids[:-1, :] != dilated_grain_ids[1:, :])
    coco_right = (dilated_phases[:, :-1] == 2) & (dilated_phases[:, 1:] == 2)
    coco_bottom = (dilated_phases[:-1, :] == 2) & (dilated_phases[1:, :] == 2)
    gb_right &= ~coco_right; gb_bottom &= ~coco_bottom
    
    p1_r, p2_r = dilated_phases[:, :-1][gb_right], dilated_phases[:, 1:][gb_right]
    p1_b, p2_b = dilated_phases[:-1, :][gb_bottom], dilated_phases[1:, :][gb_bottom]
    p_min = np.concatenate([np.minimum(p1_r, p2_r), np.minimum(p1_b, p2_b)])
    p_max = np.concatenate([np.maximum(p1_r, p2_r), np.maximum(p1_b, p2_b)])
    
    N_11 = np.sum((p_min==1) & (p_max==1))
    N_12 = np.sum((p_min==1) & (p_max==2))
    N_13 = np.sum((p_min==1) & (p_max==3))
    N_23 = np.sum((p_min==2) & (p_max==3))
    N_33 = np.sum((p_min==3) & (p_max==3))
    
    # Contiguity Formulas
    C_WC_Line = (2*N_11)/(2*N_11 + N_12) if (2*N_11 + N_12) > 0 else 0
    C_Gamma_Line = (2*N_33)/(2*N_33 + N_23 + N_13) if (2*N_33 + N_23 + N_13) > 0 else 0
    C_Hard_Line = (2*N_11 + 2*N_33 + 2*N_13)/(2*N_11 + 2*N_33 + 2*N_13 + N_12 + N_23) if (2*N_11 + 2*N_33 + 2*N_13 + N_12 + N_23) > 0 else 0
    
    C_WC_Area = N_11/(N_11 + N_12) if (N_11 + N_12) > 0 else 0
    C_Gamma_Area = N_33/(N_33 + N_23 + N_13) if (N_33 + N_23 + N_13) > 0 else 0
    C_Hard_Area = (N_11 + N_33 + N_13)/(N_11 + N_33 + N_13 + N_12 + N_23) if (N_11 + N_33 + N_13 + N_12 + N_23) > 0 else 0

    def get_sampled_c_wc(L):
        if L <= 0: return 0
        h_idx = np.linspace(0, rows-1, min(L//2, rows), dtype=int)
        v_idx = np.linspace(0, cols-1, min(L - len(h_idx), cols), dtype=int)
        n11_s, n12_s = 0, 0
        if len(h_idx)>0:
            mr = gb_right[h_idx, :]
            pm = np.minimum(dilated_phases[h_idx, :-1][mr], dilated_phases[h_idx, 1:][mr])
            px = np.maximum(dilated_phases[h_idx, :-1][mr], dilated_phases[h_idx, 1:][mr])
            n11_s += np.sum((pm==1)&(px==1)); n12_s += np.sum((pm==1)&(px==2))
        if len(v_idx)>0:
            mb = gb_bottom[:, v_idx]
            pm = np.minimum(dilated_phases[:-1, v_idx][mb], dilated_phases[1:, v_idx][mb])
            px = np.maximum(dilated_phases[:-1, v_idx][mb], dilated_phases[1:, v_idx][mb])
            n11_s += np.sum((pm==1)&(px==1)); n12_s += np.sum((pm==1)&(px==2))
        return (2*n11_s)/(2*n11_s + n12_s) if (2*n11_s+n12_s)>0 else 0

    # Grain Size & MFP
    p_ids, cts = np.unique(dilated_grain_ids, return_counts=True)
    mask = p_ids != -1; p_ids, cts = p_ids[mask], cts[mask]
    _, u_idx = np.unique(dilated_grain_ids, return_index=True)
    g_phases = dilated_phases.ravel()[u_idx][(dilated_grain_ids.ravel()[u_idx] != -1)] # correct mapping
    # Actually simpler mapping:
    g_phases = []
    for uid in p_ids: # This is slow but safe for now, better to use bincount/unique trick
        g_phases.append(dilated_phases[dilated_grain_ids == uid][0])
    g_phases = np.array(g_phases)
    d_eq = 2.0 * np.sqrt((cts * xstep**2) / np.pi)
    
    gs_wc_n = np.mean(d_eq[g_phases==1]) if np.any(g_phases==1) else 0
    gs_wc_a = np.sum(d_eq[g_phases==1] * cts[g_phases==1]) / np.sum(cts[g_phases==1]) if np.any(g_phases==1) else 0
    gs_g_n = np.mean(d_eq[g_phases==3]) if np.any(g_phases==3) else 0
    gs_g_a = np.sum(d_eq[g_phases==3] * cts[g_phases==3]) / np.sum(cts[g_phases==3]) if np.any(g_phases==3) else 0

    # Standard deviation of grain sizes
    sd_wc_n = np.std(d_eq[g_phases==1], ddof=1) if np.sum(g_phases==1) > 1 else 0
    # Area-weighted SD: sqrt( sum(w_i*(d_i - mean_a)^2) / sum(w_i) )
    if np.any(g_phases==1):
        w_wc = cts[g_phases==1]
        sd_wc_a = np.sqrt(np.sum(w_wc * (d_eq[g_phases==1] - gs_wc_a)**2) / np.sum(w_wc)) if np.sum(w_wc) > 0 else 0
    else:
        sd_wc_a = 0
    sd_g_n = np.std(d_eq[g_phases==3], ddof=1) if np.sum(g_phases==3) > 1 else 0

    vol_co = (np.sum(dilated_phases==2)/dilated_phases.size)*100
    mfp_l = (gs_wc_a * (vol_co/100)) / ((1 - vol_co/100) * (1 - C_WC_Line)) if (1-vol_co/100)*(1-C_WC_Line)>0 else 0
    mfp_a = (gs_wc_a * (vol_co/100)) / ((1 - vol_co/100) * (1 - C_WC_Area)) if (1-vol_co/100)*(1-C_WC_Area)>0 else 0

    # D10, D50, D90 calculation (Area-based)
    def calculate_d_metrics(diams, areas):
        if len(diams) == 0: return 0.0, 0.0, 0.0
        sort_idx = np.argsort(diams)
        d_s = diams[sort_idx]
        a_s = areas[sort_idx]
        cum_a = np.cumsum(a_s)
        total_a = cum_a[-1]
        if total_a == 0: return 0.0, 0.0, 0.0
        p = cum_a / total_a
        d10 = np.interp(0.1, p, d_s)
        d50 = np.interp(0.5, p, d_s)
        d90 = np.interp(0.9, p, d_s)
        return d10, d50, d90

    d10_wc, d50_wc, d90_wc = calculate_d_metrics(d_eq[g_phases==1], cts[g_phases==1]) if np.any(g_phases==1) else (0,0,0)
    d10_g, d50_g, d90_g = calculate_d_metrics(d_eq[g_phases==3], cts[g_phases==3]) if np.any(g_phases==3) else (0,0,0)

    # Save OIM Image
    oim = np.zeros((rows, cols, 3), dtype=np.uint8)
    oim[dilated_phases==1], oim[dilated_phases==2], oim[dilated_phases==3] = [254,0,0], [0,254,0], [0,0,254]
    boundary_img = np.zeros((rows, cols), dtype=bool)
    boundary_img[:, :-1] |= gb_right; boundary_img[:-1, :] |= gb_bottom
    oim[boundary_img] = [0,0,0]
    
    fig, ax = plt.subplots(figsize=(cols/100, rows/100), dpi=200)
    ax.imshow(oim); ax.axis('off')
    legend_elements = [mpatches.Patch(color='#FE0000', label='WC Phase'), mpatches.Patch(color='#00FE00', label='Co Binder'),
                       mpatches.Patch(color='#0000FE', label='Gamma Phase (\u03B3)'), mpatches.Patch(color='#000000', label='Grain Boundary')]
    ax.legend(handles=legend_elements, loc='upper right', framealpha=0.8, fontsize=12)
    plt.savefig(os.path.join(output_dir, f"OIM_CLEAN_{base_name}.png"), bbox_inches='tight', pad_inches=0.1)
    plt.close()

    # Save Grain Size Distribution Plot
    if np.any(g_phases == 1):
        wc_sizes = d_eq[g_phases == 1]
        fig, ax = plt.subplots(figsize=(8, 5))
        counts_hist, bins, _ = ax.hist(wc_sizes, bins=30, color='crimson', alpha=0.6, edgecolor='white', label='WC Grain Size')
        
        # Add Mean and SD markers
        ax.axvline(gs_wc_a, color='black', linestyle='-', linewidth=2, label=f'Area-Avg: {gs_wc_a:.2f} \u00B5m')
        ax.axvline(gs_wc_a - sd_wc_a, color='black', linestyle='--', linewidth=1)
        ax.axvline(gs_wc_a + sd_wc_a, color='black', linestyle='--', linewidth=1, label=f'SD: \u00B1{sd_wc_a:.2f} \u00B5m')
        
        ax.set_title(f"WC Grain Size Distribution - {base_name}", fontsize=12, fontweight='bold')
        ax.set_xlabel("Equivalent Diameter (\u00B5m)", fontsize=10)
        ax.set_ylabel("Frequency", fontsize=10)
        ax.legend()
        ax.grid(axis='y', alpha=0.3)
        
        plt.tight_layout()
        plt.savefig(os.path.join(output_dir, f"distribution_{base_name}.png"), dpi=150)
        plt.close()

    return {
        "Filename": base_name, "WC_Vol": (np.sum(dilated_phases==1)/dilated_phases.size)*100, 
        "Co_Vol": vol_co, "Raw_Co": (np.sum(phases==2)/phases.size)*100, "G_Vol": (np.sum(dilated_phases==3)/dilated_phases.size)*100,
        "WC_N": gs_wc_n, "WC_A": gs_wc_a, "SD_WC_N": sd_wc_n, "SD_WC_A": sd_wc_a,
        "WC_D10": d10_wc, "WC_D50": d50_wc, "WC_D90": d90_wc,
        "G_N": gs_g_n, "G_A": gs_g_a, "SD_G_N": sd_g_n,
        "G_D10": d10_g, "G_D50": d50_g, "G_D90": d90_g,
        "C5": get_sampled_c_wc(5), "C50": get_sampled_c_wc(50), "C500": get_sampled_c_wc(500), "C5000": get_sampled_c_wc(5000),
        "C_WC_L": C_WC_Line, "C_G_L": C_Gamma_Line, "C_H_L": C_Hard_Line,
        "C_WC_A": C_WC_Area, "C_G_A": C_Gamma_Area, "C_H_A": C_Hard_Area, 
        "MFP_L": mfp_l, "MFP_A": mfp_a
    }

if __name__ == "__main__":
    search_dir, co_wt, co_map = None, None, None
    i = 1
    while i < len(sys.argv):
        if sys.argv[i] == "--uploaded": search_dir = sys.argv[i+1]; i += 2
        elif sys.argv[i] == "--co-wt": co_wt = float(sys.argv[i+1]); i += 2
        elif sys.argv[i] == "--comp-map": co_map = json.loads(sys.argv[i+1]); i += 2
        else: search_dir = sys.argv[i]; i += 1
    
    if search_dir and os.path.isdir(search_dir):
        files = [f for f in glob.glob(os.path.join(search_dir, "*.ang")) if not f.endswith("_square.ang")]
        all_rep = []
        for f in files:
            bn = os.path.splitext(os.path.basename(f))[0]
            target_wt = co_map.get(os.path.basename(f), co_wt) if co_map else co_wt
            r = process_combined_microstructure(f, search_dir, co_wt=target_wt)
            if r: all_rep.append(r)
        
        with open(os.path.join(search_dir, "Microstructure_Report.txt"), 'w', encoding='utf-8') as f:
            for r in all_rep:
                f.write(f"▶ 파일명: {r['Filename']}\n   [Volume %]\n     WC 상(Phase 1): {r['WC_Vol']:.2f} %\n")
                f.write(f"     Co 상(Phase 2): {r['Co_Vol']:.2f} %  (초기 Threshold 타겟 분할량: {r['Raw_Co']:.2f} %)\n")
                f.write(f"     r 상(Phase 3):  {r['G_Vol']:.2f} %\n   [평균 입도 (Mean Grain Size)]\n")
                f.write(f"     [수량 평균 / Number-Averaged]\n       WC 입도: {r['WC_N']:.4f} μm  (SD: {r['SD_WC_N']:.4f} μm)\n       r 상 입도: {r['G_N']:.4f} μm  (SD: {r['SD_G_N']:.4f} μm)\n")
                f.write(f"     [면적 가중 평균 / Area-Weighted]\n       WC 입도 (추천): {r['WC_A']:.4f} μm  (SD: {r['SD_WC_A']:.4f} μm)\n")
                f.write(f"       WC D10: {r['WC_D10']:.4f} μm, D50: {r['WC_D50']:.4f} μm, D90: {r['WC_D90']:.4f} μm\n")
                f.write(f"       r 상 입도: {r['G_A']:.4f} μm\n")
                f.write(f"   [연결성 (Contiguity) - 선교차법(Line Intercept)]\n")
                f.write(f"     [전체 픽셀 완전 스캔값 (권장/가장정확)]\n")
                f.write(f"       WC 연결도 (C_WC_Line): {r['C_WC_L']:.4f}\n")
                f.write(f"     r상 연결도 (C_Gamma_Line): {r['C_G_L']:.4f}\n     경질상 연결도 (C_Total_Line): {r['C_H_L']:.4f}\n")
                f.write(f"   [연결성 (Contiguity) - 경계분율법(Interface Area)]\n")
                f.write(f"     WC 연결도 (C_WC_Area): {r['C_WC_A']:.4f}\n     r상 연결도 (C_Gamma_Area): {r['C_G_A']:.4f}\n")
                f.write(f"     경질상 연결도 (C_Total_Area): {r['C_H_A']:.4f}\n   [바인더 특성]\n     Co 평균자유행로 (MFP_Line): {r['MFP_L']:.4f} μm\n     Co 평균자유행로 (MFP_Area): {r['MFP_A']:.4f} μm\n")
                f.write("-" * 60 + "\n")
        print('JSON_DATA:' + json.dumps({"type": "result_pack", "txt": "Microstructure_Report.txt", "images": [os.path.basename(i) for i in glob.glob(os.path.join(search_dir, "*.png"))]}))
