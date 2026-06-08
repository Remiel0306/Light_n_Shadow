using UnrealBuildTool;
using System.Collections.Generic;

public class Light_and_ShadowEditorTarget : TargetRules
{
	public Light_and_ShadowEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.V6;
		IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_7;
		ExtraModuleNames.AddRange(new string[] { "Light_and_Shadow" });
	}
}
