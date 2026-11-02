"""ショー用の UE プロジェクトの骨組み(.uproject と Config)を新しく書く。

テンプレートを使わず、必要な項目だけを書く。C++ なし。
使い方: python make_project.py [プロジェクトのフォルダ]
"""
import json
import sys
from pathlib import Path

DEFAULT_ROOT = "work/ue_show/HackShow"
ENGINE_VERSION = "5.8"
PLUGINS = [
    "PythonScriptPlugin",
    "EditorScriptingUtilities",
    "MovieRenderPipeline",
    "MediaCompositing",
    "ElectraPlayer",
]

DEFAULT_ENGINE_INI = """[/Script/WindowsTargetPlatform.WindowsTargetSettings]
DefaultGraphicsRHI=DefaultGraphicsRHI_DX12
-D3D12TargetedShaderFormats=PCD3D_SM5
+D3D12TargetedShaderFormats=PCD3D_SM6

[/Script/Engine.RendererSettings]
r.AllowStaticLighting=False
r.DynamicGlobalIlluminationMethod=1
r.ReflectionMethod=1
r.GenerateMeshDistanceFields=True
r.Shadow.Virtual.Enable=1
r.DefaultFeature.AutoExposure=False
r.DefaultFeature.MotionBlur=False
r.VolumetricFog=1

[/Script/EngineSettings.GameMapsSettings]
EditorStartupMap=/Game/Show/L_Stage.L_Stage
GameDefaultMap=/Game/Show/L_Stage.L_Stage
"""

DEFAULT_GAME_INI = """[/Script/EngineSettings.GeneralProjectSettings]
ProjectName=HackShow
"""


def write_project(root):
    root.mkdir(parents=True, exist_ok=True)
    (root / "Config").mkdir(exist_ok=True)
    (root / "Content").mkdir(exist_ok=True)
    project = {
        "FileVersion": 3,
        "EngineAssociation": ENGINE_VERSION,
        "Category": "",
        "Description": "LED stage show, built only from Python and engine basic shapes.",
        "Plugins": [{"Name": name, "Enabled": True} for name in PLUGINS],
    }
    (root / "HackShow.uproject").write_text(json.dumps(project, indent=2), encoding="utf-8")
    (root / "Config/DefaultEngine.ini").write_text(DEFAULT_ENGINE_INI, encoding="utf-8")
    (root / "Config/DefaultGame.ini").write_text(DEFAULT_GAME_INI, encoding="utf-8")


if __name__ == "__main__":
    target = Path(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_ROOT)
    write_project(target)
    print("wrote", target)
