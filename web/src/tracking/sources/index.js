// 「人の位置を返す入力」の差し替え口。キャラの目と首は、ここから来る人の位置の先を向く。
//
// 入力(source)の約束:
//   source.kind                 'mediapipe' | 'sim' | 'pose' など(画面の表示用)
//   await source.start()        使い始める(カメラの許可など)。失敗したら例外
//   source.stop()
//   source.getPeople(nowMs)     いま見えている人の一覧を返す(毎フレーム呼ばれる)
//   source.info()               画面の状態表示用 { label, ok }
//
// getPeople が返す 1 人分(座標は place.json と同じ。ワールド、単位 m、y が上、右手系):
//   {
//     id?:       string | number  入力が人を区別できるなら付ける(無ければ、近さで同じ人とみなす)
//     position:  [x, y, z]        その人の頭(目)のワールド座標
//     gaze?:     [x, y, z]        キャラが見るべき点。無ければ position を見る。
//                                 (画面の「窓」越しに見せるときは、画面の向こうにいるカメラの位置を渡す)
//     speaking?: boolean          話しているかを入力が知っているとき(無ければ mouth から推す)
//     mouth?:    number           口の開き 0〜1(話している人を選ぶのに使う)
//   }
//
// 実装:
//   mediapipe: 端末のカメラ(端末の中だけで処理する)。画面(screen)の既定
//   sim:       マウスの位置を人の位置にする。カメラなしの試し用
//   pose:      外から位置を受け取る。AR(iPhone の殻アプリの ARKit)・VR(Quest の頭の位置)・殻の顔追跡
export { MediapipeSource } from './mediapipeSource.js';
export { SimSource } from './simSource.js';
export { PoseSource } from './poseSource.js';
