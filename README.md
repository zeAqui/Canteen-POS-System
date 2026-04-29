# Canteen Time-In — Electron App

## Build the installer (one time, on your PC)

Requirements: Node.js installed (https://nodejs.org)

1. Unzip this folder
2. Double-click BUILD.bat
3. Wait ~5 minutes (downloads Electron, builds installer)
4. Find the installer in the dist\ folder: "Canteen POS System Setup.exe"

## Deploy to any PC

Just share "Canteen POS System Setup.exe" — that's it.

The person runs it, clicks through the installer, and a desktop shortcut appears.
Double-click the shortcut to open the app. No Node.js, no browser, no terminal needed.

## Data files

After installation, the Excel log and employee CSV are stored next to the installed .exe:

  C:\Users\ "Your Username" \Documents\canteen_log.xlsx   <- your log

  
  C:\Users\ "Your Username" \Documents\employee.csv        <- your roster

To update the employee roster, edit employee.csv in that folder.

## Updating the app

Re-run BUILD.bat after making changes, then redistribute the new Setup.exe
