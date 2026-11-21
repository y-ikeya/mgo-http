// **書き出した物。手で直さない。** tools/holds/export_holds.sh が tools/raw/weapon_poses.blend の見本から作る
// (銃の持ち方 = 右手の骨から見たゲームの銃の模型の置き場所。単位は骨の空間)。直すのは Blender の見本
export const HOLDS = {
  m4: {
    // preview_m4_stand_aim
    aimHold: { position: [-10.4114, -24.4477, 2.3287], quaternion: [0.51358, 0.47599, -0.48077, 0.52776], scale: 117.41 },
    // preview_m4_crouch_aim
    crouchAimHold: { position: [-9.4869, -26.265, 2.3567], quaternion: [0.50383, 0.46101, -0.46997, 0.55925], scale: 117.41 },
    // preview_m4_crouch
    crouchHold: { position: [-5.374, -27.4709, -1.5999], quaternion: [0.53052, 0.44858, -0.39269, 0.6026], scale: 117.41 },
    // preview_m4_crouch_aim
    crouchLeftHand: { position: [-0.0598, 0.1043, -0.5033], quaternion: [0.50663, 0.1116, 0.44611, -0.72929] },
    // preview_m4_stand_aim
    leftHand: { position: [-0.049, 0.1192, -0.5162], quaternion: [0.52883, 0.01213, 0.51623, -0.67357] },
    // preview_m4_prone_aim
    proneAimHold: { position: [-3.5604, -28.6475, 3.6268], quaternion: [0.41626, 0.57585, -0.48007, 0.51446], scale: 117.41 },
    // preview_m4_prone
    proneHold: { position: [-10.7325, -24.6007, 2.5163], quaternion: [0.48681, 0.51238, -0.50718, 0.4932], scale: 117.41 },
    // preview_m4_prone_aim
    proneLeftHand: { position: [-0.0211, 0.1101, -0.5319], quaternion: [0.40394, -0.60703, 0.51643, -0.44906] },
    // preview_m4_stand
    standHold: { position: [-7.8992, -26.9561, -2.8306], quaternion: [0.53684, 0.50949, -0.43864, 0.50972], scale: 117.41 },
  },
  pistol: {
    // preview_m9_stand_aim
    aimHold: { position: [-0.6116, 7.7012, 1.9658], quaternion: [0.55516, 0.49497, -0.4468, 0.49716], scale: 117.41 },
    // preview_m9_crouch_aim
    crouchAimHold: { position: [-1.2662, 6.9138, 1.6518], quaternion: [0.57439, 0.53501, -0.46348, 0.41111], scale: 117.41 },
    // preview_m9_crouch
    crouchHold: { position: [-0.8627, 8.8086, 2.4368], quaternion: [0.61105, 0.36836, -0.4306, 0.55273], scale: 117.41 },
    // preview_m9_crouch_aim
    crouchLeftHand: { position: [-0.0545, -0.0117, 0.056], quaternion: [-0.49672, 0.28942, -0.56986, 0.58717] },
    // preview_m9_stand_aim
    leftHand: { position: [-0.0654, 0.0009, 0.0062], quaternion: [-0.47481, 0.18738, -0.59184, 0.62383] },
    // preview_m9_prone_aim
    proneAimHold: { position: [-0.0636, 8.9578, 3.0378], quaternion: [0.4706, 0.44583, -0.43198, 0.62702], scale: 117.41 },
    // preview_m9_prone
    proneHold: { position: [0.1428, 8.6771, 1.7271], quaternion: [0.60972, 0.48948, -0.42082, 0.45996], scale: 117.41 },
    // preview_m9_prone_aim
    proneLeftHand: { position: [-0.0495, -0.0127, 0.0763], quaternion: [0.32021, -0.61385, 0.54438, -0.4736] },
    // preview_m9_stand
    standHold: { position: [0.3801, 11.6054, 4.1214], quaternion: [0.46406, 0.50941, -0.58396, 0.42912], scale: 117.41 },
  },
  rifle: {
    // preview_ak_stand_aim
    aimHold: { position: [12.225, -20.4844, -15.3274], quaternion: [0.69973, -0.02658, 0.03322, 0.71314], scale: 117.41 },
    // preview_ak_crouch_aim
    crouchAimHold: { position: [13.8263, -22.2892, -14.3928], quaternion: [0.68224, -0.03028, 0.06313, 0.72777], scale: 117.41 },
    // preview_ak_crouch
    crouchHold: { position: [19.768, -20.6273, -14.2847], quaternion: [0.69233, -0.05794, 0.14843, 0.70377], scale: 117.41 },
    // preview_ak_crouch_aim
    crouchLeftHand: { position: [-0.0755, 0.2253, -0.4683], quaternion: [0.43716, -0.27933, 0.83113, -0.20024] },
    // preview_ak_stand_aim
    leftHand: { position: [-0.0606, 0.2145, -0.4812], quaternion: [0.38251, -0.36537, 0.84132, -0.11126] },
    // preview_ak_prone_aim
    proneAimHold: { position: [13.7777, -20.8346, -18.2414], quaternion: [0.70152, 0.11285, 0.02432, 0.70323], scale: 117.41 },
    // preview_ak_prone
    proneHold: { position: [9.5384, -20.2752, -17.7384], quaternion: [0.70654, 0.01808, -0.00989, 0.70738], scale: 117.41 },
    // preview_ak_prone_aim
    proneLeftHand: { position: [-0.0697, 0.1866, -0.4969], quaternion: [-0.14361, -0.71486, 0.6827, 0.04764] },
    // preview_ak_stand
    standHold: { position: [14.7501, -20.111, -19.5646], quaternion: [0.73987, -0.01934, 0.05026, 0.67059], scale: 117.41 },
  },
  smg: {
    // preview_p90_aim
    aimHold: { position: [-13.2729, -66.5729, 4.148], quaternion: [0.5, 0.5, -0.5, 0.5], scale: 117.41 },
    // preview_p90_crouch_aim
    crouchAimHold: { position: [-13.4021, -65.6387, 3.6241], quaternion: [0.5, 0.5, -0.5, 0.5], scale: 117.41 },
    // preview_p90_crouch
    crouchHold: { position: [-2.8528, -67.6356, 0.1779], quaternion: [0.53052, 0.44858, -0.39269, 0.6026], scale: 117.41 },
    // preview_p90_crouch_aim
    crouchLeftHand: { position: [-0.0558, 0.0601, -0.6724], quaternion: [0.46184, -0.02763, 0.43997, -0.76966] },
    // preview_p90_aim
    leftHand: { position: [-0.0701, 0.0986, -0.6877], quaternion: [0.23685, -0.38215, 0.67245, -0.58794] },
    // preview_p90_prone_aim
    proneAimHold: { position: [-13.2299, -64.8968, 2.3209], quaternion: [0.5, 0.5, -0.5, 0.5], scale: 117.41 },
    // preview_p90_prone
    proneHold: { position: [-6.7199, -60.8146, 6.3451], quaternion: [0.41535, 0.54506, -0.52336, 0.50645], scale: 117.41 },
    // preview_p90_prone_aim
    proneLeftHand: { position: [-0.0932, 0.1226, -0.6734], quaternion: [0.28004, -0.38296, 0.70834, -0.52266] },
    // preview_p90
    standHold: { position: [-5.6955, -67.4298, 8.9572], quaternion: [0.47457, 0.47727, -0.47369, 0.568], scale: 117.41 },
  },
  sniper: {
    // preview_sniper_stand_aim
    aimHold: { position: [27.3439, 25.0364, 5.5574], quaternion: [0.5133, -0.40243, 0.65721, 0.37768], scale: 117.41 },
    // preview_sniper_crouch_aim
    crouchAimHold: { position: [25.6852, 19.7293, 4.2378], quaternion: [0.57365, -0.51862, 0.49908, 0.39098], scale: 100.0 },
    // preview_sniper_crouch
    crouchHold: { position: [27.0691, 15.7816, 4.4353], quaternion: [0.50894, -0.51027, 0.5289, 0.44818], scale: 100.0 },
    // preview_sniper_crouch_aim
    crouchLeftHand: { position: [0.0827, 0.2327, -0.2172], quaternion: [-0.35795, 0.6367, -0.60602, -0.315] },
    // preview_sniper_stand_aim
    leftHand: { position: [0.0848, 0.2275, -0.2546], quaternion: [-0.13056, 0.54689, -0.68776, -0.45919] },
    // preview_sniper_prone_aim
    proneAimHold: { position: [29.1154, 13.7088, 5.8601], quaternion: [0.4789, -0.53443, 0.51602, 0.46771], scale: 117.41 },
    // preview_sniper_prone
    proneHold: { position: [24.2028, 19.3093, -9.2368], quaternion: [0.59904, -0.33093, 0.43507, 0.58511], scale: 117.41 },
    // preview_sniper_prone_aim
    proneLeftHand: { position: [0.0626, 0.1707, -0.1767], quaternion: [-0.00014, 0.78942, -0.4661, -0.39946] },
    // preview_sniper_stand
    standHold: { position: [30.5281, 16.2513, 4.9195], quaternion: [0.5626, -0.51451, 0.51581, 0.39077], scale: 117.41 },
  },
} as const
