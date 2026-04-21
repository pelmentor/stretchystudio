# Research References — 2D→pseudo-3D parallax, character rigging, inflation

Curated and URL-verified on 2026-04-20. See also the `NOTES.md` companion for
per-paper study notes as we work through them.

**Verification status legend:**
- ✅ URL verified live, content claim verified against primary source
- 🟡 URL verified live, content claim from secondary summaries (not opened PDF)
- ⚪ URL structurally valid but fetch blocked (403 from bot filters) — likely
  works in a browser, not independently re-verified

---

## Priority 1 — Directly applicable to auto-rig

### 1. Smith et al. 2023 — A Method for Animating Children's Drawings of the Human Figure
- **Authors:** Harrison Jesse Smith, Qingyuan Zheng, Yifei Li, Somya Jain, Jessica K. Hodgins
- **Affiliation:** Meta Reality Labs Research
- **Venue:** 2023 (arXiv preprint)
- **arXiv:** [2303.12741](https://arxiv.org/abs/2303.12741) ✅
- **Public demo:** Meta Animated Drawings (sketch.metademolab.com) 🟡
- **Dataset:** Amateur Drawings Dataset — 178K drawings + bboxes + masks + joint annotations 🟡
- **Why it matters:** Closest peer to our auto-rig. Single flat drawing → skeletal
  animation, open-source demo, public dataset we can use as stress test corpus.
  Introduces "twisted perspective retargeting" for animation quality.
- **Priority to read:** **first** — most actionable.

### 2. Smith et al. 2025 — Animating Childlike Drawings with 2.5D Character Rigs
- **Authors:** Harrison Jesse Smith, Nicky He, Yuting Ye
- **Affiliation:** Meta Reality Labs Research
- **Venue:** arXiv preprint, 2025-02-25
- **arXiv:** [2502.17866](https://arxiv.org/abs/2502.17866) ✅
- **Code:** not confirmed from arXiv page ⚪
- **Why it matters:** Direct successor to #1. "2.5D character rigs" concept is
  literally what our Cubism export produces. Pre-publication so implementation
  details may still be evolving.
- **Priority to read:** second (after #1 to understand delta vs earlier work).

### 3. Rivers, Igarashi, Durand 2010 — 2.5D Cartoon Models
- **Authors:** Alec Rivers (MIT CSAIL), Takeo Igarashi (U Tokyo), Frédo Durand (MIT CSAIL)
- **Venue:** ACM TOG / SIGGRAPH 2010
- **PDF (MIT DSpace):** [Durand-2.5D Cartoon Models.pdf](https://dspace.mit.edu/bitstream/handle/1721.1/73111/Durand-2.5D%20Cartoon%20Models.pdf) ⚪
- **Project page:** [alecrivers.com/2.5dcartoonmodels](http://www.alecrivers.com/2.5dcartoonmodels/) ⚪ (SSL cert expired, use DSpace)
- **ACM DOI:** [10.1145/1833349.1778796](https://dl.acm.org/doi/10.1145/1833349.1778796) ⚪
- **Why it matters:** Defines the "2.5D cartoon model" — stroke layers with
  depth ordering that interpolate across views. Fundamental theoretical reference
  for what a fake-3D 2D rig should be. Uses multiple 2D views (we have one) but
  the structure (layer ordering + depth cues + view interpolation) is gold.
- **Priority to read:** third — theory underpinning everything else.

### 4. Johnston 2002 — Lumo: Illumination for Cel Animation
- **Authors:** Scott F. Johnston
- **Venue:** NPAR 2002 (Non-Photorealistic Animation and Rendering)
- **PDF (SFU mirror):** [Illumination for Cel Animation.pdf](http://ivizlab.sfu.ca/arya/Papers/ACM/NPAR-02/Illumination%20for%20Cel%20Animation.pdf) ⚪
- **ACM DOI:** [10.1145/508530.508538](https://dl.acm.org/doi/10.1145/508530.508538) ⚪
- **Why it matters:** Approximates surface normals from 2D silhouette using a
  "sinus blob" where height is proportional to local 2D width. If this formula
  is literally as summarized, we can replace our cylindrical dome heuristic with
  a principled one-liner derived here.
- **⚠️ Unverified claim:** "sinus blob proportional to local width" came from
  secondary summary, not direct PDF read. Open PDF before citing as authority.
- **Priority to read:** right after #3 — potentially high ROI.

---

## Priority 2 — Inspirational / historical / cross-domain

### 5. Sýkora et al. 2014 — Ink-and-Ray: Bas-Relief Meshes for Global Illumination
- **Authors:** Daniel Sýkora (CVUT Prague), Ladislav Kavan (UPenn/ETH), Martin
  Čadík, Ondřej Jamriška, Alec Jacobson, Brian Whited, Maryann Simmons
  (Walt Disney Animation Studios), Olga Sorkine-Hornung (ETH)
- **Venue:** ACM TOG 2014, Vol 33 No 2
- **PDF (Jacobson mirror):** [ink-and-ray-tog-2014-compressed.pdf](https://www.cs.toronto.edu/~jacobson/images/ink-and-ray-tog-2014-compressed-sykora-et-al.pdf) ✅ (downloaded 922KB, metadata confirms)
- **Project page:** [dcgi.fel.cvut.cz/home/sykorad/ink-and-ray](https://dcgi.fel.cvut.cz/home/sykorad/ink-and-ray) 🟡
- **Why it matters:** Constructs a bas-relief (shallow 3D proxy) from 2D drawings
  via optimization. Direct mathematical ancestor of our depth-weighted ellipsoid.
  Disney collaboration — production-grade.
- **Priority to read:** fifth — detailed ancestor, probably too deep but worth
  skimming the bas-relief construction section.

### 6. Petrović, Fujito, Williams, Finkelstein 2000 — Shadows for Cel Animation
- **Authors:** Lena Petrović, Brian Fujito, Lance Williams, Adam Finkelstein
- **Venue:** SIGGRAPH 2000
- **PDF (Princeton):** [petrovic2000.pdf](https://gfx.cs.princeton.edu/proj/cel_shadows/petrovic2000.pdf) ✅ (downloaded 7.9MB)
- **Project page:** [gfx.cs.princeton.edu/pubs/petrovic_2000_sfc](https://gfx.cs.princeton.edu/pubs/petrovic_2000_sfc/index.php) 🟡
- **Why it matters:** Historical first "inflation from 2D" paper. Uses depth
  hints from user to inflate 2D figure into 3D proxy. Concept parent of #4, #5.
  Read for historical context and baseline simplicity.
- **Priority:** optional.

### 7. Motomura 2015 — Guilty Gear Xrd's Art Style: The X Factor Between 2D and 3D
- **Author:** Junya "Christopher" Motomura (Technical Artist, Arc System Works)
- **Venue:** GDC 2015
- **Handout PDF:** [Motomura_Junya_GuiltyGearXrd.pdf](https://www.ggxrd.com/Motomura_Junya_GuiltyGearXrd.pdf) ✅ (downloaded 4.9MB)
- **GDC Vault:** [GuiltyGearXrd's Art Style](https://www.gdcvault.com/play/1022031/GuiltyGearXrd-s-Art-Style-The) 🟡
- **YouTube:** [yhGjCzxJV3E](https://www.youtube.com/watch?v=yhGjCzxJV3E) 🟡
- **Why it matters:** Inverse problem (3D models made to LOOK 2D), but contains
  lessons on manual vertex-normal editing + per-character light vectors that
  are applicable if we ever add shading. Also frames the "kill everything 3D"
  philosophy — relevant to our "don't accidentally look 3D" goal.
- **⚠️ Unverified claim:** "manual vertex normals per character" and "dedicated
  light vector" came from secondary summary; binary PDF content wasn't parsed.
- **Priority:** optional for shading future work.

### 8. Zhou, Xiao, Lam, Fu 2024 — DrawingSpinUp: 3D Animation from Single Character Drawings
- **Authors:** Jie Zhou (CityU Hong Kong), Chufeng Xiao (HKUST), Miu-Ling Lam
  (CityU Hong Kong), Hongbo Fu (HKUST)
- **Venue:** SIGGRAPH Asia 2024
- **Project page:** [lordliang.github.io/DrawingSpinUp](https://lordliang.github.io/DrawingSpinUp/) ✅
- **arXiv:** [2409.08615](https://arxiv.org/abs/2409.08615) ✅
- **GitHub (PyTorch):** [LordLiang/DrawingSpinUp](https://github.com/LordLiang/DrawingSpinUp) ✅
- **ACM DOI:** [10.1145/3680528.3687593](https://dl.acm.org/doi/10.1145/3680528.3687593) ⚪
- **Why it matters:** Full neural 3D reconstruction from a single drawing. Probably
  overkill for our deterministic pipeline, but the skeleton-based thinning
  deformation algorithm and view-dependent contour handling are worth studying.
- **Priority:** optional — philosophically opposite direction (neural vs geometric)
  but code is public.

---

## Priority 3 — Authoritative specs / tools

### 9. Live2D Cubism official documentation
- **XY facial movement tutorial:** [docs.live2d.com/en/cubism-editor-tutorials/xy/](https://docs.live2d.com/en/cubism-editor-tutorials/xy/) ✅
- **Deformer hierarchy:** [docs.live2d.com/en/cubism-editor-tutorials/deformer/](https://docs.live2d.com/en/cubism-editor-tutorials/deformer/) 🟡
- **Why it matters:** Canonical source for parameter semantics, deformer stacking
  rules, and "put each facial part in its own warp deformer for parallax" guidance
  (which is exactly what our pipeline does).
- **Priority:** reference material, not a read-through.

### 10. Inochi2D documentation + SDK
- **Docs:** [docs.inochi2d.com](https://docs.inochi2d.com/) ⚪
- **SDK repo:** [github.com/Inochi2D/inochi2d](https://github.com/Inochi2D/inochi2d) 🟡
- **Inochi Creator:** [github.com/Inochi2D/inochi-creator](https://github.com/Inochi2D/inochi-creator) 🟡
- **Why it matters:** Open-source Live2D analog with publicly discussed rigging
  theory. Good for understanding "what's fundamental about the 2D pseudo-3D model"
  vs "what's Cubism-specific".
- **Priority:** browse issues/discussions for design debates.

---

## Priority 4 — Theoretical foundations (only if we go deep)

### 11. Multi-View Silhouette and Depth Decomposition (Smith et al. NeurIPS 2018)
- **PDF:** [proceedings.neurips.cc/.../3185-Paper.pdf](https://proceedings.neurips.cc/paper_files/paper/2018/file/39ae2ed11b14a4ccb41d35e9d1ba5d11-Paper.pdf) 🟡
- **Why it matters:** Mathematical foundation of shape-from-silhouette. We use
  one-view silhouette inflation; this covers multi-view case. Skip unless we
  need theoretical grounding.

---

---

## Round 2 additions

### 6. Sýkora et al. 2010 — Adding Depth to Cartoons Using Sparse Depth (In)equalities
- **Authors:** D. Sýkora, D. Sedláček, S. Jinchao, J. Dingliana, S. Collins
- **Venue:** EUROGRAPHICS 2010
- **PDF:** [sykora2010-sparse-depth-inequalities.pdf](reference/papers/sykora2010-sparse-depth-inequalities.pdf) ✅ (downloaded 2.2MB)
- **DCGI mirror:** [dcgi.fel.cvut.cz/~sykorad/Sykora10-EG.pdf](https://dcgi.fel.cvut.cz/~sykorad/Sykora10-EG.pdf)
- **Why it matters:** **MISSED in Round 1 — turned out to be the key paper.**
  Introduces depth (in)equality framework and Laplace-equation-with-mixed-
  boundary-conditions approach for smooth depth fields. Prequel to both
  Rivers 2010 and Ink-and-Ray 2014. **The best match for our layered-depth
  problem.**

### 7. Dvorožňák et al. 2020 — Monster Mash
- **Authors:** Marek Dvorožňák, Daniel Sýkora, Cassidy Curtis, Brian Curless,
  Olga Sorkine-Hornung, David Salesin
- **Venue:** SIGGRAPH Asia 2020
- **PDF:** [monstermash2020.pdf](reference/papers/monstermash2020.pdf) ✅ (downloaded 8.2MB)
- **Open-source:** [github.com/google/monster-mash](https://github.com/google/monster-mash)
- **Demo:** [monstermash.zone](https://monstermash.zone)
- **Why it matters:** Sýkora group's follow-up to Ink-and-Ray — joint
  inflation + ARAP-L animation. Google-collaboration open source code.
  Skimmed — ARAP-L doesn't transfer to our Cubism pipeline but reference
  implementation code is useful for validating our Poisson solver.

### 8. Yang et al. 2024 — Depth Anything V2
- **Authors:** Lihe Yang (HKU), Bingyi Kang, Zilong Huang, Zhen Zhao,
  Xiaogang Xu, Jiashi Feng, Hengshuang Zhao
- **Venue:** NeurIPS 2024
- **arXiv:** [2406.09414](https://arxiv.org/abs/2406.09414) ✅
- **PDF:** [depth-anything-v2.pdf](reference/papers/depth-anything-v2.pdf) ✅ (downloaded 48MB)
- **Code:** [github.com/DepthAnything/Depth-Anything-V2](https://github.com/DepthAnything/Depth-Anything-V2)
- **Project page:** [depth-anything-v2.github.io](https://depth-anything-v2.github.io/)
- **Why it matters:** Modern neural monocular depth estimation foundation
  model. Could be used as **validation tool** for our analytical depth
  pipeline (run on character composite PNGs, compare with our output).
  Not recommended as runtime dependency for production export.

---

## Studying sequence we agreed on

1. Smith 2023 (#1) — start here, open code + demo
2. Smith 2025 (#2) — delta vs 2023
3. Rivers 2010 (#3) — theory of 2.5D structure
4. Johnston 2002 (#4) — verify sinus-blob formula; consider replacing dome heuristic
5. Sýkora 2014 (#5) — skim bas-relief construction if #4 didn't cover enough
6. Everything else on demand

Per-paper study notes land in `NOTES.md` as we go.
