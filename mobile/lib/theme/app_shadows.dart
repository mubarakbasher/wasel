import 'package:flutter/material.dart';

/// Soft, slate-tinted shadow scale ("Soft UI Evolution").
///
/// Shadows are tinted with slate-900 (#0F172A) instead of pure black so they
/// read as ambient depth on the slate background rather than dirt.
class AppShadows {
  AppShadows._();

  static const List<BoxShadow> xs = [
    BoxShadow(color: Color(0x0A0F172A), blurRadius: 2, offset: Offset(0, 1)),
  ];
  static const List<BoxShadow> sm = [
    BoxShadow(color: Color(0x0D0F172A), blurRadius: 8, offset: Offset(0, 2)),
    BoxShadow(color: Color(0x080F172A), blurRadius: 2, offset: Offset(0, 1)),
  ];
  static const List<BoxShadow> md = [
    BoxShadow(color: Color(0x140F172A), blurRadius: 16, offset: Offset(0, 4)),
  ];
  static const List<BoxShadow> lg = [
    BoxShadow(color: Color(0x1A0F172A), blurRadius: 28, offset: Offset(0, 8)),
  ];
}
