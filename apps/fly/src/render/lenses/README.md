# FPV camera lens profiles

Camera calibrations from Gyroflow's lens profile database, copied unchanged and renamed.

- Source: https://github.com/gyroflow/lens_profiles, commit `886fc616c9c2c788856f54c21d451b9cb7fc4f44` (2026-07-28)
- License: **CC0 1.0** (the repository's `LICENSE`). Credit to each calibrator below anyway.
- Model: every file uses Gyroflow's default `opencv_fisheye` model (no `distortion_model` field): a ray at angle
  `θ` from the lens axis lands at normalised image radius `θ (1 + k0 θ² + k1 θ⁴ + k2 θ⁶ + k3 θ⁸)`.
  `../lens.ts` reads them.
- Chosen (2026-10-18) as the best calibration of each camera: the curve may not fold back anywhere inside the
  picture (Gyroflow's `radial_distortion_limit`); then low RMS error and more calibration images, official ones first.
  Analog calibrations vary a lot between captures: of the three Ratel files in the database, only the NTSC one
  is usable (the other two fold inside the picture).

| File | Original path in lens_profiles | Calibrated by | Date |
|---|---|---|---|
| caddx-ratel-2.json | Caddx/Caddx_Ratel V2__NTSC_720p_16by9_1280x720-30.00fps.json | Stephen Ogborne | 2022-08-02 |
| foxeer-razer-pico.json | Foxeer/Foxeer_Razer Pico___480p_3by2_720x480-60.00fps.json | Nick Gauthier | 2024-08-15 |
| runcam-phoenix-2-jb.json | RunCam/RunCam_phoenix jb___480p_3by2_720x480-30.00fps.json | Rory Mace | 2022-10-17 |
| dji-vista-4x3.json | Caddx/Caddx_Vista__DVR_480p_4by3_960x720-0.00fps.json | Anonymous | 2021-02-06 |
| dji-air-unit-16x9.json | DJI/DJI_Air Unit_DJI 2.1 mm, f2.1_Wide_1080p_16by9_1920x1080-0.00fps.json | G42L | 2021-08-17 |
| caddx-nebula-pro-4x3.json | Caddx/Caddx_Nebula Pro___480p_4by3_960x720-60.00fps.json | Akos Pajdusak | 2022-04-11 |
| dji-o3-16x9.json | DJI/DJI_Goggles2 From Avata_O3 air Unit__1080p_16by9_1920x1080-50.00fps.json | Henry Zhang | 2024-01-15 |
| dji-o4-wide-16x9.json | DJI/DJI_O4_Air_Flywoo O4 Wide lens_normal_4k_16by9_3840x2160-59.94fps.json | FLYWOO | 2025-11-02 |
| dji-o4-wide-4x3.json | DJI/DJI_O4_Air_Flywoo O4 Wide lens_normal_4k_4by3_3840x2160-59.94fps.json | FLYWOO | 2025-11-02 |
| walksnail-avatar-pro-16x9.json | Walksnail/Walksnail_fpv cam_Walksnail_Avatar_Pro_Camera_1080p_16by9_60fps wide_1080p60_1080p_16by9_1920x1080-60.02fps.json | nicecrash_23 | 2023-04-10 |
| walksnail-avatar-v2-4x3.json | Walksnail/Walksnail_fpv cam_Walksnail_Avatar_V2_Camera_1080p_4by3_60fps wide_1080_60_4by_3_720p_4by3_1440x1080-60.02fps.json | nicecrash_23 | 2023-04-10 |
| walksnail-moonlight-16x9.json | Walksnail/Walksnail_AvatarMoonlight__1080p_16by9_1920x1080-60.00fps.json | Walksnail | 2023-11-28 |
| hdzero-nano-16x9.json | Other/HDZero_HDZero_Nano_Default_Default_720p_16by9_1280x720-59.96fps.json | Søren | 2022-02-06 |
| hdzero-micro-v2-4x3.json | RunCam/RunCam_HDZERO Micro V2_Stock__480p_4by3_960x720-59.94fps.json | Ondrej Slachta | 2022-07-11 |
| runcam-link-phoenix-hd-16x9.json | RunCam/RunCam_Link Phoenix HD Kit___720p_16by9_1280x720-60.00fps.json | casemag | 2024-05-09 |

The calibrations are of recorded video (DVR or onboard recording), which can be framed a little differently from
the live feed in the goggles.
