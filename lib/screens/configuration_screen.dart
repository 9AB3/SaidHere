import 'package:flutter/material.dart';

import '../widgets/brand_mark.dart';
import '../widgets/wall_background.dart';

class ConfigurationScreen extends StatelessWidget {
  const ConfigurationScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: WallBackground(
        heavy: true,
        child: SafeArea(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 560),
              child: const Padding(
                padding: EdgeInsets.all(28),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    BrandMark(),
                    SizedBox(height: 32),
                    Text(
                      'BACKEND NOT CONFIGURED',
                      style: TextStyle(fontWeight: FontWeight.w900, fontSize: 20),
                    ),
                    SizedBox(height: 12),
                    Text(
                      'Start The Wall with API_BASE_URL as a Dart define pointing at the Render web service. The README has the exact command.',
                      textAlign: TextAlign.center,
                      style: TextStyle(height: 1.5, fontWeight: FontWeight.w700),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
