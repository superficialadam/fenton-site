#!/bin/bash

# Convert particle animation frames to MP4 video
# Usage: ./frames_to_mp4.sh

# Configuration
DOWNLOADS_DIR="$HOME/Downloads"
OUTPUT_DIR="$HOME/Downloads"
FRAME_PATTERN="frame_*.jpg"
OUTPUT_NAME="particle_animation_$(date +%Y%m%d_%H%M%S).mp4"
FRAMERATE=30

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Particle Animation Frame to MP4 Converter ===${NC}"
echo ""

# Check if ffmpeg is installed
if ! command -v ffmpeg &> /dev/null; then
    echo -e "${RED}Error: ffmpeg is not installed${NC}"
    echo "Install with: brew install ffmpeg (macOS) or sudo apt install ffmpeg (Linux)"
    exit 1
fi

# Check if frames exist in Downloads
cd "$DOWNLOADS_DIR" || exit 1
FRAME_COUNT=$(ls -1 $FRAME_PATTERN 2>/dev/null | wc -l)

if [ "$FRAME_COUNT" -eq 0 ]; then
    echo -e "${RED}Error: No frames found matching pattern '$FRAME_PATTERN' in $DOWNLOADS_DIR${NC}"
    exit 1
fi

echo -e "${YELLOW}Found $FRAME_COUNT frames in $DOWNLOADS_DIR${NC}"

# Get the first frame number
FIRST_FRAME=$(ls -1 frame_*.jpg | head -n1 | sed 's/frame_//;s/.jpg//')
echo -e "First frame number: ${GREEN}$FIRST_FRAME${NC}"

# Get frame dimensions from first frame
FIRST_FILE=$(ls -1 $FRAME_PATTERN | head -n 1)
DIMENSIONS=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "$FIRST_FILE")
echo -e "Frame dimensions: ${GREEN}$DIMENSIONS${NC}"
echo -e "Framerate: ${GREEN}${FRAMERATE}fps${NC}"

# Calculate expected duration
DURATION=$(echo "scale=2; $FRAME_COUNT / $FRAMERATE" | bc)
echo -e "Expected duration: ${GREEN}${DURATION} seconds${NC}"
echo ""

# Convert frames to MP4 using glob pattern if available, otherwise use sequence
echo -e "${YELLOW}Converting frames to MP4...${NC}"

# Try glob pattern first (Linux/Mac)
if ffmpeg -framerate $FRAMERATE -pattern_type glob -i 'frame_*.jpg' -c:v libx264 -pix_fmt yuv420p -crf 18 -y "$OUTPUT_DIR/test.mp4" 2>/dev/null; then
    rm -f "$OUTPUT_DIR/test.mp4"
    echo "Using glob pattern..."
    
    ffmpeg -framerate $FRAMERATE \
           -pattern_type glob \
           -i 'frame_*.jpg' \
           -c:v libx264 \
           -pix_fmt yuv420p \
           -crf 18 \
           -preset medium \
           -movflags +faststart \
           -y \
           "$OUTPUT_DIR/$OUTPUT_NAME" 2>&1 | \
           grep -E "frame=|size=|time=|bitrate=|speed=" | \
           sed 's/^/  /'
else
    echo "Using sequence pattern..."
    
    # Use sequence pattern (more compatible)
    ffmpeg -framerate $FRAMERATE \
           -start_number "$FIRST_FRAME" \
           -i "frame_%05d.jpg" \
           -c:v libx264 \
           -pix_fmt yuv420p \
           -crf 18 \
           -preset medium \
           -movflags +faststart \
           -y \
           "$OUTPUT_DIR/$OUTPUT_NAME" 2>&1 | \
           grep -E "frame=|size=|time=|bitrate=|speed=" | \
           sed 's/^/  /'
fi

# Check if conversion was successful
if [ -f "$OUTPUT_DIR/$OUTPUT_NAME" ]; then
    OUTPUT_SIZE=$(du -h "$OUTPUT_DIR/$OUTPUT_NAME" | cut -f1)
    
    # Verify the video duration
    ACTUAL_DURATION=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$OUTPUT_DIR/$OUTPUT_NAME")
    
    echo ""
    echo -e "${GREEN}✓ Video created successfully!${NC}"
    echo -e "  Output: $OUTPUT_DIR/$OUTPUT_NAME"
    echo -e "  Size: $OUTPUT_SIZE"
    echo -e "  Duration: ${ACTUAL_DURATION}s (expected: ${DURATION}s)"
    echo ""
    
    # Play the video (optional)
    if command -v vlc &> /dev/null; then
        read -p "Play the video with VLC? (y/n) " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            vlc "$OUTPUT_DIR/$OUTPUT_NAME" &
        fi
    fi
    
    # Ask before deleting frames
    read -p "Delete the original frame files? (y/n) " -n 1 -r
    echo ""
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}Deleting frames...${NC}"
        rm -f $FRAME_PATTERN
        echo -e "${GREEN}✓ Frames deleted${NC}"
    else
        echo -e "${YELLOW}Frames kept in $DOWNLOADS_DIR${NC}"
    fi
else
    echo -e "${RED}✗ Error: Failed to create video${NC}"
    echo "Check the ffmpeg output above for errors"
    
    # Debug: Try creating a simple test video
    echo ""
    echo -e "${YELLOW}Attempting debug test...${NC}"
    ffmpeg -f lavfi -i testsrc=duration=1:size=320x240:rate=30 -pix_fmt yuv420p "$OUTPUT_DIR/test.mp4" -y 2>&1
    if [ -f "$OUTPUT_DIR/test.mp4" ]; then
        echo -e "${GREEN}FFmpeg is working. Issue is with frame input.${NC}"
        rm -f "$OUTPUT_DIR/test.mp4"
        
        echo ""
        echo "Debugging frame sequence:"
        echo "First 5 frames:"
        ls -1 frame_*.jpg | head -5
        echo "Last 5 frames:"
        ls -1 frame_*.jpg | tail -5
    else
        echo -e "${RED}FFmpeg test failed. Check ffmpeg installation.${NC}"
    fi
    
    exit 1
fi

echo ""
echo -e "${GREEN}=== Done ===${NC}"