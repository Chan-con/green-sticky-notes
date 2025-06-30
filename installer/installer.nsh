; NSISスクリプト - デスクトップアイコン作成オプション

; グローバル変数
Var CreateDesktopShortcut
Var DesktopCheckbox

; 初期化
!macro customInit
  StrCpy $CreateDesktopShortcut "1"
!macroend

; カスタムページを追加
!macro customPageAfterChangeDir
  Page custom DesktopShortcutPage DesktopShortcutPageLeave
!macroend

; カスタムページ関数
Function DesktopShortcutPage
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  
  ; ページタイトル
  GetDlgItem $0 $HWNDPARENT 1037
  SendMessage $0 ${WM_SETTEXT} 0 "STR:追加タスクの選択"
  
  GetDlgItem $0 $HWNDPARENT 1038
  SendMessage $0 ${WM_SETTEXT} 0 "STR:Green Sticky Notesの追加タスクを選択してください。"
  
  ; ラベル
  ${NSD_CreateLabel} 0 0 100% 20u "追加のタスクを選択してください："
  Pop $0
  
  ; チェックボックス
  ${NSD_CreateCheckbox} 10 30u 100% 15u "&デスクトップにアイコンを作成する"
  Pop $DesktopCheckbox
  
  ; デフォルトでチェック済み
  ${If} $CreateDesktopShortcut == "1"
    ${NSD_SetState} $DesktopCheckbox ${BST_CHECKED}
  ${EndIf}
  
  nsDialogs::Show
FunctionEnd

Function DesktopShortcutPageLeave
  ${NSD_GetState} $DesktopCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $CreateDesktopShortcut "1"
  ${Else}
    StrCpy $CreateDesktopShortcut "0"
  ${EndIf}
FunctionEnd

; インストール後の処理
!macro customInstall
  ${If} $CreateDesktopShortcut == "1"
    CreateShortCut "$DESKTOP\Green Sticky Notes.lnk" "$INSTDIR\${PRODUCT_FILENAME}.exe" "" "$INSTDIR\${PRODUCT_FILENAME}.exe" 0 SW_SHOWNORMAL "" "${PRODUCT_NAME}"
  ${EndIf}
!macroend

; アンインストール時の処理
!macro customUnInstall
  Delete "$DESKTOP\Green Sticky Notes.lnk"
!macroend