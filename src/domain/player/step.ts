/**
 * 構えた所から一歩下がる (locomotion の step_back / crouch_step_back)。
 *
 * **立ちもしゃがみも同じ距離・同じ時間** (本人 2026-10-30「両方0.7mで1秒にしよう」)。型は
 * 立ちが 0.68m / 0.96 秒、しゃがみが 1.16m / 1.1 秒 (膝を突き終わるまで) なので、画面の側
 * (animation.ts の playStepBack) が再生速度と移動の倍率でここへ合わせる。
 * CQC の間合い (CQC_REACH 1.8m) から少し外へ出るくらい
 */

/** 下がる距離 (m) */
export const STEP_BACK_DISTANCE = 0.7

/** 下がり切るまで (秒)。この間は銃を下ろし、他の動作を重ねない */
export const STEP_BACK_SECONDS = 1.0
