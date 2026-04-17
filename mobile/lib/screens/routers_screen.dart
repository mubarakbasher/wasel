import 'package:flutter/material.dart';

import '../i18n/app_localizations.dart';

class RoutersScreen extends StatelessWidget {
  const RoutersScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(context.tr('routers.title'))),
      body: Center(
        child: Text(
          context.tr('routers.title'),
          style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w600),
        ),
      ),
    );
  }
}
