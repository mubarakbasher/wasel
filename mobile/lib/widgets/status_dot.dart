import 'package:flutter/material.dart';

/// Single-size status dot (default 10px) — replaces the 8/10/12px drift.
class StatusDot extends StatelessWidget {
  const StatusDot(this.color, {super.key, this.size = 10});

  final Color color;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );
  }
}
