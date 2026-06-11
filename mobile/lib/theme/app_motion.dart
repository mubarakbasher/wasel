import 'package:flutter/material.dart';

/// Shared motion tokens — one rhythm for all transitions.
class AppMotion {
  AppMotion._();

  static const Duration fast = Duration(milliseconds: 150);
  static const Duration base = Duration(milliseconds: 250);
  static const Duration slow = Duration(milliseconds: 350);

  static const Curve curve = Curves.easeOutCubic;
}
