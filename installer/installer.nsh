; NSISスクリプト - デスクトップアイコン作成オプション

; デスクトップショートカット作成フラグ
Var CreateDesktopShortcut

; カスタムページを追加するためのマクロ
!macro customInit
  ; デフォルトでデスクトップショートカットを作成する（チェック済み）
  StrCpy $CreateDesktopShortcut "1"
!macroend

; カスタムページの定義
!macro customPageAfterChangeDir
  ; カスタムページを挿入
  !insertmacro MUI_PAGE_CUSTOM DesktopShortcutPage DesktopShortcutPageLeave
!macroend

; ページ関数
Function DesktopShortcutPage
  !insertmacro MUI_HEADER_TEXT "追加タスクの選択" "Green Sticky Notesの追加タスクを選択してください。"
  
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  
  ${NSD_CreateLabel} 0 0 100% 20u "追加のタスクを選択してください："
  Pop $0
  
  ${NSD_CreateCheckbox} 10 30u 100% 15u "&デスクトップにアイコンを作成する"
  Pop $1
  
  ; デフォルトでチェック済みに設定
  ${If} $CreateDesktopShortcut == "1"
    ${NSD_SetState} $1 ${BST_CHECKED}
  ${EndIf}
  
  nsDialogs::Show
FunctionEnd

Function DesktopShortcutPageLeave
  ${NSD_GetState} $1 $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $CreateDesktopShortcut "1"
  ${Else}
    StrCpy $CreateDesktopShortcut "0"
  ${EndIf}
FunctionEnd

; インストール完了後の処理
!macro customInstall
  ; デスクトップショートカットを作成するかチェック
  ${If} $CreateDesktopShortcut == "1"
    CreateShortCut "$DESKTOP\Green Sticky Notes.lnk" "$INSTDIR\Green Sticky Notes.exe" "" "$INSTDIR\Green Sticky Notes.exe" 0 SW_SHOWNORMAL "" "Green Sticky Notes"
  ${EndIf}
!macroend

; アンインストール時の処理
!macro customUnInstall
  ; デスクトップショートカットを削除
  Delete "$DESKTOP\Green Sticky Notes.lnk"
!macroend