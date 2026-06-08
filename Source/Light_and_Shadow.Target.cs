using UnrealBuildTool;
using System.Collections.Generic;

public class Light_and_ShadowTarget : TargetRules
{
	public Light_and_ShadowTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.V6;
		IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_7;
		ExtraModuleNames.AddRange(new string[] { "Light_and_Shadow" });
	}
}
