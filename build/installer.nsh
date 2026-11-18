; Personalização do instalador NSIS (electron-builder).
; O atalho no Menu Iniciar é sempre criado pelo electron-builder.
; Tela final: "Abrir o Monitor" + "Criar atalho na área de trabalho" (marcada por padrão).

!macro customFinishPage
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  Function CriarAtalhoAreaDeTrabalho
    CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
  FunctionEnd

  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !define MUI_FINISHPAGE_SHOWREADME ""
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Criar atalho na área de trabalho"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION CriarAtalhoAreaDeTrabalho
  !insertmacro MUI_PAGE_FINISH
!macroend

!macro customUnInstall
  ; ao desinstalar (não em atualização), remove o atalho da área de trabalho
  ${ifNot} ${isUpdated}
    Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
  ${endIf}
!macroend
