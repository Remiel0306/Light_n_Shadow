# 第一次 Clone 後怎麼開專案

這是 **C++ 專案**（有 `Source/` 資料夾）。Git **不會**帶 `Binaries/`、`Intermediate/`，所以 clone 後**一定要編譯一次**，否則會出現：

- `Light_and_ShadowEditor.target does not exist`
- `MCP_Bridge built with different engine version`
- 按 Yes 重建卻 **Compile failed**

刪掉或改名 `Plugins/UE_MCP_Bridge` **通常沒用**，因為 `.uproject` 仍會找這個插件，且主專案本身仍要編譯。

---

## 必要條件

| 項目 | 說明 |
|------|------|
| **Unreal Engine** | **5.7**（與 `Light_and_Shadow.uproject` 的 `EngineAssociation` 一致） |
| **Visual Studio 2022** | 勾選 **使用 C++ 的桌面開發**；建議 MSVC **14.44**（VS Installer → 個別元件 → MSVC v143） |
| **磁碟空間** | 第一次編譯約需數 GB 暫存 |

引擎若不在 `D:\UE_5.7`，請先設定環境變數再跑腳本：

```bat
set UE_ROOT=C:\你的路徑\UE_5.7
Setup_FirstTime.bat
```

---

## 推薦步驟（最簡單）

1. `git clone` 專案  
2. 雙擊執行 **`Setup_FirstTime.bat`**（會清掉壞掉的 Intermediate 並編譯 Editor）  
3. 成功後雙擊 **`Light_and_Shadow.uproject`** 開啟  

**不要**在還沒編譯成功前一直按 Launcher 的 Yes/No 亂試；先跑完 `Setup_FirstTime.bat`。

---

## 若編譯仍失敗

1. 用 VS 開啟專案根目錄的 **`Light_and_Shadow.sln`**（若沒有，右鍵 `.uproject` → *Generate Visual Studio project files*）  
2. 設定：**Development Editor**、平台 **Win64**  
3. 建置方案，看 **錯誤清單** 第一條紅字  
4. 常見原因：UE 版本不是 5.7、沒裝 C++ 工作負載、路徑含特殊字元權限問題  

手動清快取後再編譯：

```bat
rmdir /s /q Intermediate
rmdir /s /q Binaries
rmdir /s /q Plugins\UE_MCP_Bridge\Intermediate
rmdir /s /q Plugins\UE_MCP_Bridge\Binaries
```

然後再執行 `Setup_FirstTime.bat`。

---

## UE_MCP_Bridge（Cursor 自動化用，可選）

預設 **已關閉**，一般玩遊戲 / 改 Blueprint **不需要**。

只有要用 Cursor + MCP 自動改 Blueprint 時才開：

1. 編輯 `Light_and_Shadow.uproject`  
2. 找到 `UE_MCP_Bridge`，把 `"Enabled": false` 改成 `true`  
3. 重新編譯（MCP 插件依賴很多 Editor 模組，編譯較久、也較容易失敗）  

若出現 **built with different engine version**：代表本機 `Plugins/UE_MCP_Bridge/Binaries` 是用別台或舊版 UE 编的 → 刪掉該插件下的 `Binaries` 和 `Intermediate` 後重編。

---

## 給專案維護者

- 不要把 `Binaries/`、`Intermediate/`、`Saved/` 提交到 Git（已在 `.gitignore`）  
- 協作者只需編譯 **Light_and_Shadow** 主模組；MCP 保持關閉即可穩定開啟  
