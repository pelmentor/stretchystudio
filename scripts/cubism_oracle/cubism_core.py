"""
ctypes bindings for Live2DCubismCore.dll — the C ABI of Cubism Core.

Used by the oracle harness (CUBISM_WARP_PORT.md, Phase 0) to load a .moc3 +
.model buffer pair, drive parameter values, and read out post-eval drawable
vertex positions as numeric ground truth for the v3 evaluator port.

The DLL ships with the Live2D Cubism Native SDK and as a redistributable in
several runtimes (Ren'Py, Unity native plugin, etc). The default search path
below points at the Ren'Py 8.5 install on this dev machine; override with the
LIVE2D_CUBISM_CORE env var to point at any other valid copy.

API reference: live2d.com/sdk/cubism/core/api  (Live2DCubismCore.h is public)
"""
from __future__ import annotations

import ctypes
import os
import struct
from ctypes import (
    CFUNCTYPE,
    POINTER,
    c_char_p,
    c_float,
    c_int,
    c_int32,
    c_uint,
    c_uint32,
    c_void_p,
)
from pathlib import Path

DEFAULT_DLL_PATH = r"D:\renpy-8.5.0-sdk\lib\py3-windows-x86_64\Live2DCubismCore.dll"

# Required alignment (from Live2DCubismCore.h — csmAlignofMoc / csmAlignofModel)
ALIGN_OF_MOC = 64
ALIGN_OF_MODEL = 16


def _aligned_buffer(size: int, alignment: int) -> tuple[ctypes.Array, int]:
    """Over-allocate, return (raw_buf, aligned_addr).

    Hold a reference to raw_buf for the lifetime of aligned_addr — Python will
    free the underlying memory otherwise.
    """
    raw = (ctypes.c_ubyte * (size + alignment))()
    addr = ctypes.addressof(raw)
    aligned = (addr + alignment - 1) & ~(alignment - 1)
    return raw, aligned


def load_dll(path: str | os.PathLike | None = None) -> ctypes.WinDLL:
    """Load Live2DCubismCore.dll and bind the API surface we use."""
    dll_path = Path(path or os.environ.get("LIVE2D_CUBISM_CORE", DEFAULT_DLL_PATH))
    if not dll_path.is_file():
        raise FileNotFoundError(
            f"Live2DCubismCore.dll not found at {dll_path}. Set LIVE2D_CUBISM_CORE env "
            f"var to a valid copy (Cubism Native SDK, or shipped with Ren'Py at "
            f"renpy-X.Y.Z-sdk/lib/py3-windows-x86_64/)."
        )
    dll = ctypes.WinDLL(str(dll_path))

    # --- Versions / consistency
    dll.csmGetVersion.restype = c_uint32
    dll.csmGetVersion.argtypes = []

    dll.csmGetLatestMocVersion.restype = c_uint32
    dll.csmGetLatestMocVersion.argtypes = []

    dll.csmGetMocVersion.restype = c_uint32
    dll.csmGetMocVersion.argtypes = [c_void_p, c_uint32]

    dll.csmHasMocConsistency.restype = c_int32
    dll.csmHasMocConsistency.argtypes = [c_void_p, c_uint32]

    # --- Moc / Model lifecycle
    # csmMoc* csmReviveMocInPlace(void* address, unsigned int size)
    dll.csmReviveMocInPlace.restype = c_void_p
    dll.csmReviveMocInPlace.argtypes = [c_void_p, c_uint32]

    # unsigned int csmGetSizeofModel(const csmMoc* moc)
    dll.csmGetSizeofModel.restype = c_uint32
    dll.csmGetSizeofModel.argtypes = [c_void_p]

    # csmModel* csmInitializeModelInPlace(const csmMoc* moc, void* address, unsigned int size)
    dll.csmInitializeModelInPlace.restype = c_void_p
    dll.csmInitializeModelInPlace.argtypes = [c_void_p, c_void_p, c_uint32]

    # void csmUpdateModel(csmModel* model)
    dll.csmUpdateModel.restype = None
    dll.csmUpdateModel.argtypes = [c_void_p]

    # void csmReadCanvasInfo(const csmModel*, csmVector2*, csmVector2*, float*)
    dll.csmReadCanvasInfo.restype = None
    dll.csmReadCanvasInfo.argtypes = [c_void_p, c_void_p, c_void_p, POINTER(c_float)]

    # --- Parameters
    dll.csmGetParameterCount.restype = c_int32
    dll.csmGetParameterCount.argtypes = [c_void_p]

    dll.csmGetParameterIds.restype = POINTER(c_char_p)
    dll.csmGetParameterIds.argtypes = [c_void_p]

    dll.csmGetParameterTypes.restype = POINTER(c_int32)
    dll.csmGetParameterTypes.argtypes = [c_void_p]

    dll.csmGetParameterMinimumValues.restype = POINTER(c_float)
    dll.csmGetParameterMinimumValues.argtypes = [c_void_p]

    dll.csmGetParameterMaximumValues.restype = POINTER(c_float)
    dll.csmGetParameterMaximumValues.argtypes = [c_void_p]

    dll.csmGetParameterDefaultValues.restype = POINTER(c_float)
    dll.csmGetParameterDefaultValues.argtypes = [c_void_p]

    # The values pointer is read/write — write here to drive the model.
    dll.csmGetParameterValues.restype = POINTER(c_float)
    dll.csmGetParameterValues.argtypes = [c_void_p]

    # --- Parts
    dll.csmGetPartCount.restype = c_int32
    dll.csmGetPartCount.argtypes = [c_void_p]

    dll.csmGetPartIds.restype = POINTER(c_char_p)
    dll.csmGetPartIds.argtypes = [c_void_p]

    dll.csmGetPartOpacities.restype = POINTER(c_float)
    dll.csmGetPartOpacities.argtypes = [c_void_p]

    dll.csmGetPartParentPartIndices.restype = POINTER(c_int32)
    dll.csmGetPartParentPartIndices.argtypes = [c_void_p]

    # --- Drawables
    dll.csmGetDrawableCount.restype = c_int32
    dll.csmGetDrawableCount.argtypes = [c_void_p]

    dll.csmGetDrawableIds.restype = POINTER(c_char_p)
    dll.csmGetDrawableIds.argtypes = [c_void_p]

    dll.csmGetDrawableConstantFlags.restype = POINTER(ctypes.c_uint8)
    dll.csmGetDrawableConstantFlags.argtypes = [c_void_p]

    dll.csmGetDrawableDynamicFlags.restype = POINTER(ctypes.c_uint8)
    dll.csmGetDrawableDynamicFlags.argtypes = [c_void_p]

    dll.csmGetDrawableTextureIndices.restype = POINTER(c_int32)
    dll.csmGetDrawableTextureIndices.argtypes = [c_void_p]

    dll.csmGetDrawableDrawOrders.restype = POINTER(c_int32)
    dll.csmGetDrawableDrawOrders.argtypes = [c_void_p]

    dll.csmGetDrawableRenderOrders.restype = POINTER(c_int32)
    dll.csmGetDrawableRenderOrders.argtypes = [c_void_p]

    dll.csmGetDrawableOpacities.restype = POINTER(c_float)
    dll.csmGetDrawableOpacities.argtypes = [c_void_p]

    dll.csmGetDrawableVertexCounts.restype = POINTER(c_int32)
    dll.csmGetDrawableVertexCounts.argtypes = [c_void_p]

    # const float** csmGetDrawableVertexPositions(const csmModel*)
    # Returns array of pointers to per-drawable vec2 arrays (interleaved x,y).
    dll.csmGetDrawableVertexPositions.restype = POINTER(POINTER(c_float))
    dll.csmGetDrawableVertexPositions.argtypes = [c_void_p]

    dll.csmGetDrawableVertexUvs.restype = POINTER(POINTER(c_float))
    dll.csmGetDrawableVertexUvs.argtypes = [c_void_p]

    dll.csmGetDrawableIndexCounts.restype = POINTER(c_int32)
    dll.csmGetDrawableIndexCounts.argtypes = [c_void_p]

    dll.csmGetDrawableIndices.restype = POINTER(POINTER(ctypes.c_uint16))
    dll.csmGetDrawableIndices.argtypes = [c_void_p]

    dll.csmGetDrawableParentPartIndices.restype = POINTER(c_int32)
    dll.csmGetDrawableParentPartIndices.argtypes = [c_void_p]

    dll.csmResetDrawableDynamicFlags.restype = None
    dll.csmResetDrawableDynamicFlags.argtypes = [c_void_p]

    return dll


class CubismModel:
    """Loaded csmModel ready for parameter-driven eval + vertex readout.

    Holds the underlying raw buffers for moc + model so they aren't garbage
    collected while the model pointer is in use.
    """

    def __init__(self, dll: ctypes.WinDLL, moc_bytes: bytes):
        self.dll = dll
        size = len(moc_bytes)
        self._moc_raw, moc_addr = _aligned_buffer(size, ALIGN_OF_MOC)
        ctypes.memmove(moc_addr, moc_bytes, size)

        consistent = dll.csmHasMocConsistency(moc_addr, size)
        if consistent != 1:
            raise ValueError(
                f"csmHasMocConsistency returned {consistent} — moc is malformed "
                "or version-incompatible."
            )

        self.moc_ptr = dll.csmReviveMocInPlace(moc_addr, size)
        if not self.moc_ptr:
            raise RuntimeError("csmReviveMocInPlace returned NULL.")

        model_size = dll.csmGetSizeofModel(self.moc_ptr)
        self._model_raw, model_addr = _aligned_buffer(model_size, ALIGN_OF_MODEL)
        self.model_ptr = dll.csmInitializeModelInPlace(self.moc_ptr, model_addr, model_size)
        if not self.model_ptr:
            raise RuntimeError("csmInitializeModelInPlace returned NULL.")

        # Cache common counts + arrays
        self.parameter_count = int(dll.csmGetParameterCount(self.model_ptr))
        ids_ptr = dll.csmGetParameterIds(self.model_ptr)
        self.parameter_ids = [
            ids_ptr[i].decode("utf-8") for i in range(self.parameter_count)
        ]
        self._param_index = {pid: i for i, pid in enumerate(self.parameter_ids)}

        self.drawable_count = int(dll.csmGetDrawableCount(self.model_ptr))
        d_ids = dll.csmGetDrawableIds(self.model_ptr)
        self.drawable_ids = [
            d_ids[i].decode("utf-8") for i in range(self.drawable_count)
        ]

        self.part_count = int(dll.csmGetPartCount(self.model_ptr))
        p_ids = dll.csmGetPartIds(self.model_ptr)
        self.part_ids = [p_ids[i].decode("utf-8") for i in range(self.part_count)]

    @classmethod
    def from_file(cls, dll: ctypes.WinDLL, moc_path: str | os.PathLike) -> "CubismModel":
        return cls(dll, Path(moc_path).read_bytes())

    # --- Parameter access
    def parameter_default_values(self) -> list[float]:
        ptr = self.dll.csmGetParameterDefaultValues(self.model_ptr)
        return [float(ptr[i]) for i in range(self.parameter_count)]

    def parameter_min_max(self) -> list[tuple[float, float]]:
        mn = self.dll.csmGetParameterMinimumValues(self.model_ptr)
        mx = self.dll.csmGetParameterMaximumValues(self.model_ptr)
        return [(float(mn[i]), float(mx[i])) for i in range(self.parameter_count)]

    def get_parameter_values(self) -> list[float]:
        ptr = self.dll.csmGetParameterValues(self.model_ptr)
        return [float(ptr[i]) for i in range(self.parameter_count)]

    def set_parameter(self, name: str, value: float) -> None:
        idx = self._param_index.get(name)
        if idx is None:
            raise KeyError(f"Parameter {name!r} not found. Available: {self.parameter_ids[:10]}...")
        ptr = self.dll.csmGetParameterValues(self.model_ptr)
        ptr[idx] = c_float(value).value

    def reset_parameters_to_defaults(self) -> None:
        defaults = self.parameter_default_values()
        ptr = self.dll.csmGetParameterValues(self.model_ptr)
        for i, v in enumerate(defaults):
            ptr[i] = v

    # --- Eval
    def update(self) -> None:
        self.dll.csmUpdateModel(self.model_ptr)

    # --- Drawable readout
    def drawable_vertex_counts(self) -> list[int]:
        ptr = self.dll.csmGetDrawableVertexCounts(self.model_ptr)
        return [int(ptr[i]) for i in range(self.drawable_count)]

    def drawable_vertex_positions(self) -> list[list[tuple[float, float]]]:
        """Per-drawable list of (x, y) post-eval canvas-px positions."""
        counts = self.drawable_vertex_counts()
        outer = self.dll.csmGetDrawableVertexPositions(self.model_ptr)
        out: list[list[tuple[float, float]]] = []
        for i, n in enumerate(counts):
            inner = outer[i]
            verts = [(float(inner[2 * j]), float(inner[2 * j + 1])) for j in range(n)]
            out.append(verts)
        return out

    def canvas_info(self) -> dict:
        size = (c_float * 2)()
        origin = (c_float * 2)()
        ppu = c_float(0.0)
        self.dll.csmReadCanvasInfo(
            self.model_ptr,
            ctypes.cast(size, c_void_p),
            ctypes.cast(origin, c_void_p),
            ctypes.byref(ppu),
        )
        return {
            "size": (size[0], size[1]),
            "origin": (origin[0], origin[1]),
            "pixels_per_unit": ppu.value,
        }


def core_version_string(dll: ctypes.WinDLL) -> str:
    v = int(dll.csmGetVersion())
    major = (v >> 24) & 0xFF
    minor = (v >> 16) & 0xFF
    patch = v & 0xFFFF
    return f"{major}.{minor}.{patch}"
