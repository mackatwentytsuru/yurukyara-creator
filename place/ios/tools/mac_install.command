#!/bin/zsh
# 場所スキャン(RoomScan)か ARステージ(ARStage)を署名つきで組み立て、つないである iPhone に入れる。
# 署名つきの組み立ては GUI のセッションからでないと通らないので、ssh から `open mac_install.command` で開く。
# 前もって ~/sample_work/place_ios/ に次のファイルを置く:
#   team.txt(署名のチーム ID)・device_id.txt(iPhone の UDID)・scheme.txt(RoomScan か ARStage。無ければ RoomScan)・
#   url.txt(ARStage が開くページの URL。ARStage のときだけ)
cd ~/sample_work/place_ios || exit 1
export PATH=/opt/homebrew/bin:$HOME/.local/bin:$PATH
rm -f install.done install.log
TEAM="$(cat team.txt)"
DEVICE="$(cat device_id.txt)"
SCHEME="$(cat scheme.txt 2>/dev/null || echo RoomScan)"
URL="$(cat url.txt 2>/dev/null)"
{
  echo "== 組み立て $SCHEME $(date)"
  xcodegen generate
  xcodebuild -project RoomScan.xcodeproj -scheme "$SCHEME" -configuration Debug \
    -destination "id=$DEVICE" -derivedDataPath ./build \
    DEVELOPMENT_TEAM="$TEAM" ARSTAGE_URL="$URL" -allowProvisioningUpdates build
  RC=$?
  echo "組み立て終了コード $RC"
  if [ "$RC" = 0 ]; then
    APP="build/Build/Products/Debug-iphoneos/$SCHEME.app"
    echo "== 入れる $APP"
    xcrun devicectl device install app --device "$DEVICE" "$APP"
    RC=$?
    echo "入れる終了コード $RC"
  fi
  echo $RC > install.done
} > install.log 2>&1
echo "終わりました(終了コード $(cat install.done))。この窓は閉じてかまいません。"
