"""UE の Python の起動の台本(環境変数 UE_PYTHONPATH にこのフォルダを入れて UE を起動したときだけ読まれる)。
コマンドラインに -EntranceKiosk があるときだけ、入口の LED の受け口(entrance_runtime.py)を動かす。それ以外は何もしない。
プロジェクトの設定は変えない(ショーの UE プロジェクトのほかの作業に影響しない)。
"""
import unreal

if "-entrancekiosk" in unreal.SystemLibrary.get_command_line().lower():
    import entrance_runtime

    entrance_runtime.start()
