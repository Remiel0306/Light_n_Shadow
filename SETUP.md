# Light_and_Shadow — 同學第一次 Clone 教學

**請用 branch `7`，不要用 `main`。** `main` 是舊版。

---

## 事前準備（兩樣都要有）

1. **Unreal Engine 5.7**（Epic Launcher 安裝，版本必須是 5.7）
2. **Visual Studio 2022**，安裝時勾選 **「使用 C++ 的桌面開發」**

若編譯失敗，再到 VS Installer → **個別元件** → 安裝 **MSVC v143（14.44）**。

---

## 步驟 1：Clone 並切到 branch 7

```bat
git clone https://github.com/Remiel0306/Light_n_Shadow.git
cd Light_n_Shadow
git checkout 7
```

Git Extensions 使用者：Fetch 後在 `remotes/origin/7` 右鍵 **Checkout**。

---

## 步驟 2：第一次編譯（必做，不能跳過）

**還沒編譯成功前，不要雙擊 `.uproject`。**

1. 進專案根目錄（有 `Light_and_Shadow.uproject` 的那一層）
2. 雙擊 **`Setup_FirstTime.bat`**
3. 等到黑視窗出現 **`[OK] Build finished`**（第一次約 5～15 分鐘）

UE 不在 `D:\UE_5.7` 時，先開 cmd：

```bat
set UE_ROOT=C:\Program Files\Epic Games\UE_5.7
Setup_FirstTime.bat
```

（路徑改成你電腦上的 UE 5.7 資料夾。）

---

## 步驟 3：開啟專案

1. 雙擊 **`Light_and_Shadow.uproject`**
2. 選 **Unreal Engine 5.7**
3. 若問 rebuild 且步驟 2 已成功 → 可選 **No**
4. 等右下角 **Shader Compiling** 跑完

還是當機 → 雙擊 **`Launch_UE_Safe.bat`** 再開一次。

---

## 步驟 4：確認 Blueprint 在哪

真正的 BP **不在** `BluePrint` 根目錄（根目錄 3KB 的是舊轉向檔，可忽略）。

| 資料夾 | 內容 |
|--------|------|
| `Content/BluePrint/Player/` | `BP_ThirdPersonCharacter`（約 1.4MB）、`BP_LightBall` |
| `Content/BluePrint/Enemy/` | `BP_EnemyShadowLogic` |
| `Content/BluePrint/Object/` | 物件／窗戶影子 BP |
| `Content/BluePrint/System/` | AI Controller 等 |

Content Browser 搜尋 **`BP_ThirdPersonCharacter`** 應能找到。

---

## 步驟 5：Content Browser 是空的怎麼辦

先確認檔案總管裡 `Content\BluePrint\Player\BP_ThirdPersonCharacter.uasset` 約 **1.4MB**。

若檔案在、UE 卻看不到：

1. **關掉 UE**
2. 雙擊 **`Fix_ContentBrowser.bat`**（或手動刪 `Saved`、`DerivedDataCache`）
3. 重開 `.uproject`
4. Content Browser：眼睛勾 **Show Game Content**，Filters **Reset**，再搜尋 `BP_`

---

## 常見錯誤

| 訊息 | 處理 |
|------|------|
| `target does not exist` | 先跑 `Setup_FirstTime.bat` |
| `MCP_Bridge different version` | 不要刪插件；確認 `.uproject` 裡 MCP 是 `"Enabled": false`，重跑 bat |
| branch 只有 main | `git fetch` → `git checkout 7` |
| 關卡全黑 | Viewport 按 `L`（Lit）；等 Shader 編完 |
| Player 資料夾 BP 只有 3KB | `git checkout 7` + `git pull`，沒拉完整 |

---

## MCP（可選，同學不用開）

`UE_MCP_Bridge` 預設關閉。只有作者用 Cursor 自動改 BP 時才開。

---

## 維護者（Remiel）Push 前檢查

- [ ] 在 branch **7** 上
- [ ] `Setup_FirstTime.bat`、`Fix_ContentBrowser.bat`、`Launch_UE_Safe.bat`、`SETUP.md` 已 commit
- [ ] `Light_and_Shadow.uproject` 裡 MCP `"Enabled": false`
- [ ] 不要 commit `Binaries/`、`Intermediate/`、`Saved/`
- [ ] 通知同學：**clone 後 checkout 7 → 跑 bat → 再開 UE**
