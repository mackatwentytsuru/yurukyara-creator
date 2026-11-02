#!/bin/zsh
# 場所スキャンを署名つきで組み立て、つないである iPhone に入れる。
# 署名つきの組み立ては GUI のセッションからでないと通らないので、ssh から `open mac_install.command` で開く。
# 前もって ~/sample_work/place_ios/ に team.txt(署名のチーム ID)と device_id.txt(iPhone の UDID)を置く。
cd ~/sample_work/place_ios || exit 1
export PATH=/opt/homebrew/bin:$HOME/.local/bin:$PATH
rm -f install.done install.log
TEAM="$(cat team.txt)"
DEVICE="$(cat device_id.txt)"
{
  echo "== 組み立て $(date)"
  xcodegen generate
  xcodebuild -project RoomScan.xcodeproj -scheme RoomScan -configuration Debug \
    -destination "id=$DEVICE" -derivedDataPath ./build \
    DEVELOPMENT_TEAM="$TEAM" -allowProvisioningUpdates build
  RC=$?
  echo "組み立て終了コード $RC"
  if [ "$RC" = 0 ]; then
    APP="$(ls -d build/Build/Products/Debug-iphoneos/RoomScan.app)"
    echo "== 入れる $APP"
    xcrun devicectl device install app --device "$DEVICE" "$APP"
    RC=$?
    echo "入れる終了コード $RC"
  fi
  echo $RC > install.done
} > install.log 2>&1
echo "終わりました(終了コード $(cat install.done))。この窓は閉じてかまいません。"
