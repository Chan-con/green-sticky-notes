; NSISスクリプト - デスクトップアイコン作成オプション

; グローバル変数
Var CreateDesktopShortcut

; インストール後の処理
!macro customInstall
  ; デフォルトでデスクトップショートカットを作成
  CreateShortCut "$DESKTOP\Green Sticky Notes.lnk" "$INSTDIR\${PRODUCT_FILENAME}.exe"
!macroend

; アンインストール時の処理
!macro customUnInstall
  Delete "$DESKTOP\Green Sticky Notes.lnk"
!macroend