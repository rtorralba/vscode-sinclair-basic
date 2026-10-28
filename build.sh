#!/usr/bin/env bash
set -euo pipefail

# Asegurar que estamos en el directorio del script
cd "$(dirname "$0")"

echo "==================================================================="
echo "    Sinclair BASIC - VS Code Extension Builder (Linux / WSL)"
echo "==================================================================="
echo ""

# 1. Verificar si Node y npm estan disponibles
if ! command -v npm >/dev/null 2>&1; then
    echo "[ERROR] No se encontro 'npm' en el PATH del sistema."
    echo "Por favor instala Node.js desde https://nodejs.org/"
    exit 1
fi

run_tests() {
    echo ""
    echo "-------------------------------------------------------------------"
    echo " [1/2] Ejecutando tests unitarios..."
    echo "-------------------------------------------------------------------"
    if ! npm test; then
        echo ""
        echo "[ERROR] Los tests fallaron. Abortando construccion."
        return 1
    fi
    echo "[OK] Todos los tests pasaron exitosamente."
}

do_test() {
    run_tests
}

do_package() {
    run_tests
    echo ""
    echo "-------------------------------------------------------------------"
    echo " [2/2] Generando paquete VSIX con vsce..."
    echo "-------------------------------------------------------------------"
    if ! npx --yes @vscode/vsce package; then
        echo ""
        echo "[ERROR] Fallo al generar el paquete .vsix."
        return 1
    fi

    echo ""
    echo "==================================================================="
    echo "[EXITO] Paquete VSIX generado correctamente en el directorio raiz."
    echo "==================================================================="
    for f in *.vsix; do
        [ -e "$f" ] && echo "  - $f"
    done
    echo ""
}

do_install() {
    run_tests
    echo ""
    echo "-------------------------------------------------------------------"
    echo " Generando paquete VSIX..."
    echo "-------------------------------------------------------------------"
    if ! npx --yes @vscode/vsce package; then
        echo "[ERROR] Fallo al empaquetar."
        return 1
    fi

    LATEST_VSIX=$(ls -t ./*.vsix 2>/dev/null | head -n 1 || true)
    if [ -z "$LATEST_VSIX" ]; then
        echo "[ERROR] No se encontro archivo .vsix para instalar."
        return 1
    fi

    echo ""
    echo "-------------------------------------------------------------------"
    echo " Instalando $LATEST_VSIX en VS Code local..."
    echo "-------------------------------------------------------------------"
    if ! command -v code >/dev/null 2>&1; then
        echo "[AVISO] El comando 'code' de VS Code no se encuentra en el PATH."
        echo "Puedes instalar el archivo manualmente con:"
        echo "  VS Code > Extensions > ... (Views and More Actions) > Install from VSIX..."
        return 0
    fi

    if ! code --install-extension "$LATEST_VSIX" --force; then
        echo "[ERROR] Error al instalar la extension en VS Code."
        return 1
    fi

    echo ""
    echo "[EXITO] Extension instalada en tu VS Code local correctamente."
}

do_publish() {
    run_tests
    echo ""
    echo "==================================================================="
    echo " Publicar en Visual Studio Code Marketplace"
    echo "==================================================================="
    echo "Publisher configurado en package.json: rtorralba"
    echo ""
    echo "NOTA: Para publicar necesitas un Personal Access Token (PAT)"
    echo "de Azure DevOps con permiso 'Marketplace (Manage)'."
    echo "Si tienes la variable de entorno VSCE_PAT configurada, se usara"
    echo "automaticamente. De lo contrario, se te solicitara ahora."
    echo ""

    PAT_ARGS=()
    if [ -n "${VSCE_PAT:-}" ]; then
        echo "[INFO] Detectada variable de entorno VSCE_PAT."
        PAT_ARGS=(-p "$VSCE_PAT")
    else
        echo "¿Deseas introducir tu Personal Access Token PAT ahora?"
        echo "[Si ya hiciste vsce login previamente en este equipo, pulsa ENTER para omitir]"
        read -r -p "PAT Token (o Enter para omitir): " USER_PAT
        if [ -n "$USER_PAT" ]; then
            PAT_ARGS=(-p "$USER_PAT")
        fi
    fi

    echo ""
    echo "¿Deseas incrementar la version antes de publicar?"
    echo "  [1] Mantener version actual"
    echo "  [2] Patch (1.0.0 -> 1.0.1)"
    echo "  [3] Minor (1.0.0 -> 1.1.0)"
    echo "  [4] Major (1.0.0 -> 2.0.0)"
    read -r -p "Elige opcion de version [1-4, por defecto 1]: " BUMP_CHOICE

    BUMP_ARGS=()
    case "${BUMP_CHOICE:-1}" in
        2) BUMP_ARGS=(patch) ;;
        3) BUMP_ARGS=(minor) ;;
        4) BUMP_ARGS=(major) ;;
        *) BUMP_ARGS=() ;;
    esac

    echo ""
    echo "-------------------------------------------------------------------"
    echo " Publicando extension en el Marketplace..."
    echo "-------------------------------------------------------------------"
    if ! npx --yes @vscode/vsce publish "${BUMP_ARGS[@]}" "${PAT_ARGS[@]}"; then
        echo ""
        echo "[ERROR] Hubo un problema al publicar."
        echo "Revisa el mensaje superior para verificar el token o permisos."
        return 1
    fi

    echo ""
    echo "==================================================================="
    echo "[EXITO] ¡Extension publicada con exito en el Marketplace de VS Code!"
    echo "==================================================================="
}

# Si se pasa un argumento desde linea de comandos, ir directo
if [ $# -gt 0 ]; then
    case "${1,,}" in
        package) do_package; exit 0 ;;
        install) do_install; exit 0 ;;
        publish) do_publish; exit 0 ;;
        test)    do_test;    exit 0 ;;
        *)
            echo "Uso: $0 [package|install|publish|test]"
            exit 1
            ;;
    esac
fi

while true; do
    echo "Selecciona una opcion:"
    echo ""
    echo "  [1] Compilar y empaquetar archivo .vsix"
    echo "  [2] Compilar e instalar extension en este VS Code (Local)"
    echo "  [3] Publicar en Visual Studio Code Marketplace"
    echo "  [4] Ejecutar tests unitarios (npm test)"
    echo "  [0] Salir"
    echo ""
    read -r -p "Elige una opcion [1-4, 0]: " OPCION

    case "$OPCION" in
        1)
            do_package || true
            read -r -p "Pulsa ENTER para continuar..." _
            ;;
        2)
            do_install || true
            read -r -p "Pulsa ENTER para continuar..." _
            ;;
        3)
            do_publish || true
            read -r -p "Pulsa ENTER para continuar..." _
            ;;
        4)
            do_test || true
            echo ""
            read -r -p "Pulsa ENTER para continuar..." _
            ;;
        0)
            echo "Saliendo..."
            exit 0
            ;;
        *)
            echo ""
            echo "Opcion invalida. Intentalo de nuevo."
            echo ""
            ;;
    esac
done
