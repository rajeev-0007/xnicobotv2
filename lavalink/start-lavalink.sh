#!/bin/bash
# Start Lavalink 4.2.1 (DAVE protocol support)
# Requires Java 17+ installed: apt install openjdk-17-jre-headless

LAVALINK_DIR="$(cd "$(dirname "$0")" && pwd)"
LAVALINK_JAR="$LAVALINK_DIR/Lavalink.jar"
LAVALINK_VERSION="4.2.1"
DOWNLOAD_URL="https://github.com/lavalink-devs/Lavalink/releases/download/${LAVALINK_VERSION}/Lavalink.jar"

# Check Java
if ! command -v java &> /dev/null; then
    echo "<:Cancel:1473037949187657818> Java 17+ is required. Install with:"
    echo "   sudo apt install openjdk-17-jre-headless"
    exit 1
fi

JAVA_VER=$(java -version 2>&1 | head -1 | cut -d'"' -f2 | cut -d'.' -f1)
if [ "$JAVA_VER" -lt 17 ] 2>/dev/null; then
    echo "<:Cancel:1473037949187657818> Java 17+ required, found Java $JAVA_VER"
    exit 1
fi

# Download Lavalink if not present
if [ ! -f "$LAVALINK_JAR" ]; then
    echo "⬇️  Downloading Lavalink v${LAVALINK_VERSION}..."
    curl -L -o "$LAVALINK_JAR" "$DOWNLOAD_URL"
    if [ $? -ne 0 ]; then
        echo "<:Cancel:1473037949187657818> Download failed"
        exit 1
    fi
    echo "<:Checkedbox:1473038547165384804> Downloaded Lavalink v${LAVALINK_VERSION}"
fi

echo "🚀 Starting Lavalink v${LAVALINK_VERSION} with DAVE support..."
cd "$LAVALINK_DIR"
exec java -jar "$LAVALINK_JAR"
