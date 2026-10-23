"""Reject oversized or invalid scan geometry before allocating large grids."""
import math
from pathlib import Path

MAX_INPUT_BYTES = 1024 * 1024 * 1024
MAX_SCAN_POINTS = 20_000_000
MAX_GRID_DIMENSION = 16384


def check_input_file(path):
    size = Path(path).stat().st_size
    if size <= 0 or size > MAX_INPUT_BYTES:
        raise ValueError('분석 파일은 비어 있지 않은 1 GiB 이하 파일이어야 합니다.')


def check_grid_shape(rows, columns):
    if (rows <= 0 or columns <= 0 or rows > MAX_GRID_DIMENSION
            or columns > MAX_GRID_DIMENSION or rows * columns > MAX_SCAN_POINTS):
        raise ValueError('격자 크기가 안전한 분석 한도(2,000만 점, 축당 16,384점)를 벗어났습니다.')


def square_axes(xmap, step):
    import numpy as np
    xmin, xmax = float(xmap.x.min()), float(xmap.x.max())
    ymin, ymax = float(xmap.y.min()), float(xmap.y.max())
    if not all(math.isfinite(value) for value in (xmin, xmax, ymin, ymax, step)) or step <= 0:
        raise ValueError('측정 좌표와 격자 간격은 유한한 값이고 간격은 양수여야 합니다.')
    nx, ny = (xmax - xmin) / step + 1, (ymax - ymin) / step + 1
    if not math.isfinite(nx) or not math.isfinite(ny):
        raise ValueError('측정 격자 범위를 계산할 수 없습니다.')
    check_grid_shape(math.ceil(ny), math.ceil(nx))
    x = np.arange(xmin, xmax + step * .5, step)
    y = np.arange(ymin, ymax + step * .5, step)
    check_grid_shape(len(y), len(x))
    return x, y
