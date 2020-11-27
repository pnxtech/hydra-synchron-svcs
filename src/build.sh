# Syntax: ./build.sh
# Use --no-cache=true  when necessary
VERSION_TAG=$(<VERSION)
docker build --no-cache=true -t hydra-synchron-svcs:$VERSION_TAG .
