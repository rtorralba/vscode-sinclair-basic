@echo off
setlocal EnableDelayedExpansion
title Sinclair BASIC - Build ^& Publish

:: Asegurar que estamos en el directorio del script
cd /d "%~dp0"

echo ===================================================================
echo     Sinclair BASIC - VS Code Extension Builder
echo ===================================================================
echo.

:: 1. Verificar si Node y npm estan disponibles
where npm >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] No se encontro 'npm' en el PATH del sistema.
    echo Por favor instala Node.js desde https://nodejs.org/
    pause
    exit /b 1
)

:: Si se pasa un argumento desde linea de comandos, ir directo
if /i "%~1"=="package" goto :do_package
if /i "%~1"=="publish" goto :do_publish
if /i "%~1"=="install" goto :do_install
if /i "%~1"=="test"    goto :do_test

:menu
echo Selecciona una opcion:
echo.
echo   [1] Compilar y empaquetar archivo .vsix
echo   [2] Compilar e instalar extension en este VS Code (Local)
echo   [3] Publicar en Visual Studio Code Marketplace
echo   [4] Ejecutar tests unitarios (npm test)
echo   [0] Salir
echo.
set /p OPCION="Elige una opcion [1-4, 0]: "

if "%OPCION%"=="1" goto :do_package
if "%OPCION%"=="2" goto :do_install
if "%OPCION%"=="3" goto :do_publish
if "%OPCION%"=="4" goto :do_test
if "%OPCION%"=="0" goto :salir

echo.
echo Opcion invalida. Intentalo de nuevo.
echo.
goto :menu

:: -----------------------------------------------------------------
:: EJECUTAR TESTS
:: -----------------------------------------------------------------
:run_tests
echo.
echo -------------------------------------------------------------------
echo  [1/2] Ejecutando tests unitarios...
echo -------------------------------------------------------------------
call npm test
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Los tests fallaron. Abortando construccion.
    pause
    exit /b 1
)
echo [OK] Todos los tests pasaron exitosamente.
exit /b 0

:do_test
call :run_tests
echo.
pause
goto :menu

:: -----------------------------------------------------------------
:: EMPAQUETAR (.vsix)
:: -----------------------------------------------------------------
:do_package
call :run_tests
if %ERRORLEVEL% neq 0 exit /b 1

echo.
echo -------------------------------------------------------------------
echo  [2/2] Generando paquete VSIX con vsce...
echo -------------------------------------------------------------------
call npx --yes @vscode/vsce package
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Fallo al generar el paquete .vsix.
    pause
    exit /b 1
)

echo.
echo ===================================================================
echo [EXITO] Paquete VSIX generado correctamente en el directorio raiz.
echo ===================================================================
for %%f in (*.vsix) do echo   - %%f
echo.
pause
goto :menu

:: -----------------------------------------------------------------
:: EMPAQUETAR E INSTALAR LOCALMENTE
:: -----------------------------------------------------------------
:do_install
call :run_tests
if %ERRORLEVEL% neq 0 exit /b 1

echo.
echo -------------------------------------------------------------------
echo  Generando paquete VSIX...
echo -------------------------------------------------------------------
call npx --yes @vscode/vsce package
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Fallo al empaquetar.
    pause
    exit /b 1
)

:: Encontrar el archivo .vsix mas reciente
for /f "delims=" %%I in ('dir /b /o:-d *.vsix 2^>nul') do (
    set "LATEST_VSIX=%%I"
    goto :found_vsix
)

:found_vsix
if not defined LATEST_VSIX (
    echo [ERROR] No se encontro archivo .vsix para instalar.
    pause
    exit /b 1
)

echo.
echo -------------------------------------------------------------------
echo  Instalando %LATEST_VSIX% en VS Code local...
echo -------------------------------------------------------------------
where code >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [AVISO] El comando 'code' de VS Code no se encuentra en el PATH.
    echo Puedes instalar el archivo manualmente con:
    echo   VS Code ^> Extensions ^> ... (Views and More Actions) ^> Install from VSIX...
    pause
    goto :menu
)

call code --install-extension "%LATEST_VSIX%" --force
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Error al instalar la extension en VS Code.
    pause
    exit /b 1
)

echo.
echo [EXITO] Extension instalada en tu VS Code local correctamente.
pause
goto :menu

:: -----------------------------------------------------------------
:: PUBLICAR AL MARKETPLACE
:: -----------------------------------------------------------------
:do_publish
call :run_tests
if %ERRORLEVEL% neq 0 exit /b 1

echo.
echo ===================================================================
echo  Publicar en Visual Studio Code Marketplace
echo ===================================================================
echo Publisher configurado en package.json: rtorralba
echo.
echo NOTA: Para publicar necesitas un Personal Access Token (PAT)
echo de Azure DevOps con permiso "Marketplace (Manage)".
echo Si tienes la variable de entorno VSCE_PAT configurada, se usara
echo automaticamente. De lo contrario, se te solicitara ahora.
echo.

set "PAT_ARG="
if defined VSCE_PAT (
    echo [INFO] Detectada variable de entorno VSCE_PAT.
    set PAT_ARG=-p "!VSCE_PAT!"
) else (
    echo Deseas introducir tu Personal Access Token (PAT) ahora?
    echo (Si ya hiciste 'vsce login' previamente en este equipo, pulsa ENTER para omitir)
    set /p USER_PAT="PAT Token (o Enter para omitir): "
    if not "!USER_PAT!"=="" (
        set PAT_ARG=-p "!USER_PAT!"
    )
)

echo.
echo Deseas incrementar la version antes de publicar?
echo   [1] Mantener version actual
echo   [2] Patch (1.0.0 -^> 1.0.1)
echo   [3] Minor (1.0.0 -^> 1.1.0)
echo   [4] Major (1.0.0 -^> 2.0.0)
set /p BUMP_CHOICE="Elige opcion de version [1-4, por defecto 1]: "

set "BUMP_ARG="
if "%BUMP_CHOICE%"=="2" set BUMP_ARG=patch
if "%BUMP_CHOICE%"=="3" set BUMP_ARG=minor
if "%BUMP_CHOICE%"=="4" set BUMP_ARG=major

echo.
echo -------------------------------------------------------------------
echo  Publicando extension en el Marketplace...
echo -------------------------------------------------------------------
if not "%BUMP_ARG%"=="" (
    call npx --yes @vscode/vsce publish %BUMP_ARG% %PAT_ARG%
) else (
    call npx --yes @vscode/vsce publish %PAT_ARG%
)

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Hubo un problema al publicar.
    echo Revisa el mensaje superior para verificar el token o permisos.
    pause
    goto :menu
)

echo.
echo ===================================================================
echo [EXITO] Extension publicada con exito en el Marketplace de VS Code!
echo ===================================================================
pause
goto :menu

:salir
echo Saliendo...
exit /b 0
