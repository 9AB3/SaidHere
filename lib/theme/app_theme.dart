import 'package:flutter/material.dart';

class SaidHereTheme {
  static const ink = Color(0xFF17130F);
  static const paper = Color(0xFFD8CCB6);
  static const paperDark = Color(0xFFB7A68C);
  static const rust = Color(0xFF7E4B32);
  static const grime = Color(0xFF5D5548);
  static const fadedRed = Color(0xFF8E4E43);
  static const fadedBlue = Color(0xFF617A7B);
  static const fadedYellow = Color(0xFF9E8550);

  static ThemeData get light {
    final scheme = ColorScheme.fromSeed(
      seedColor: ink,
      brightness: Brightness.light,
    ).copyWith(
      surface: paper,
      primary: ink,
      secondary: rust,
    );

    const hardCorners = BorderRadius.all(Radius.circular(3));

    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: paper,
      fontFamily: 'monospace',
      dividerColor: ink.withValues(alpha: .22),
      appBarTheme: const AppBarTheme(
        backgroundColor: Colors.transparent,
        foregroundColor: ink,
        elevation: 0,
        centerTitle: false,
        titleTextStyle: TextStyle(
          color: ink,
          fontFamily: 'monospace',
          fontSize: 20,
          fontWeight: FontWeight.w900,
          letterSpacing: -.8,
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: ink,
          foregroundColor: paper,
          minimumSize: const Size.fromHeight(54),
          shape: const RoundedRectangleBorder(borderRadius: hardCorners),
          textStyle: const TextStyle(
            fontWeight: FontWeight.w900,
            letterSpacing: .2,
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: ink,
          side: const BorderSide(color: ink, width: 1.5),
          shape: const RoundedRectangleBorder(borderRadius: hardCorners),
          textStyle: const TextStyle(fontWeight: FontWeight.w900),
        ),
      ),
      cardTheme: CardThemeData(
        color: const Color(0xFFE0D5C0).withValues(alpha: .92),
        elevation: 0,
        shape: const RoundedRectangleBorder(
          borderRadius: hardCorners,
          side: BorderSide(color: Color(0x55362E24)),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: const Color(0xFFE7DDCB).withValues(alpha: .88),
        hintStyle: TextStyle(color: ink.withValues(alpha: .5)),
        border: const OutlineInputBorder(
          borderRadius: hardCorners,
          borderSide: BorderSide(color: ink),
        ),
        enabledBorder: const BorderSideInputBorder(borderRadius: hardCorners),
        focusedBorder: const OutlineInputBorder(
          borderRadius: hardCorners,
          borderSide: BorderSide(color: ink, width: 2),
        ),
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: Color(0xFFD8CCB6),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(4)),
        ),
      ),
    );
  }
}

class BorderSideInputBorder extends OutlineInputBorder {
  const BorderSideInputBorder({required super.borderRadius})
      : super(borderSide: const BorderSide(color: SaidHereTheme.ink, width: 1.3));
}
