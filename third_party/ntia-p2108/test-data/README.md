# Recommendation ITU-R P.2108 Test Data #

[![NTIA/ITS PropLib][proplib-badge]][proplib-link]
[![GitHub Release][gh-releases-badge]][gh-releases-link]
[![GitHub Issues][gh-issues-badge]][gh-issues-link]
[![DOI][doi-badge]][doi-link]

[proplib-badge]: https://img.shields.io/badge/PropLib-badge?label=%F0%9F%87%BA%F0%9F%87%B8%20NTIA%2FITS&labelColor=162E51&color=D63E04
[proplib-link]: https://ntia.github.io/propagation-library-wiki
[gh-releases-badge]: https://img.shields.io/github/v/release/NTIA/p2108-test-data?logo=github&label=Release&labelColor=162E51&color=D63E04
[gh-releases-link]: https://github.com/NTIA/p2108-test-data/releases
[gh-issues-badge]: https://img.shields.io/github/issues/NTIA/p2108-test-data?logo=github&label=Issues&labelColor=162E51
[gh-issues-link]: https://github.com/NTIA/p2108-test-data/issues
[doi-badge]: https://zenodo.org/badge/892826210.svg
[doi-link]: https://zenodo.org/badge/latestdoi/892826210

This repository contains a dataset used to test the NTIA/ITS implementations
of Recommendation ITU-R P.2108 - Prediction of clutter loss.

The software tested with this dataset can be found using the links below.

- [NTIA/p2108](https://github.com/NTIA/p2108)
- [NTIA/p2108-dotnet](https://github.com/NTIA/p2108-dotnet)
- [NTIA/p2108-matlab](https://github.com/NTIA/p2108-matlab)
- [NTIA/p2108-python](https://github.com/NTIA/p2108-python)

## Data Disclaimer ##

This dataset is not intended for any use other than running unit tests against
the software in the repositories listed above. Data contained in this repository
should not be expected to reflect, for example, real-world radio propagation links.
In some instances, intentionally invalid data are provided to ensure that errors
are properly handled in the software under test.

## Dataset Versioning ##

The versioning of this dataset is tracked with a single-digit version number
in the format `v1`. This version number indicates the software versions for which
this test dataset is valid. For example, `v1` of this repository contains the dataset
used to test `v1.x` of the base C++ library and `v1.x.y` of the .NET, MATLAB®, and Python®
wrappers.

## Dataset Contents ##

Each CSV file in this repository contains a set of inputs and outputs used to test
the operation of one of the functions provided by the software under test.
The header row of each file indicates the name of each data column, and each subsequent row
represents a single test case.

- `HeightGainTerminalCorrectionModelTestData.csv` contains sets of inputs and outputs used
  to test the operation of the `HeightGainTerminalCorrectionModel` function.
- `TerrestrialStatisticalModelTestData.csv` contains sets of inputs and outputs used
  to test the operation of the `TerrestrialStatisticalModel` function.
- `AeronauticalStatisticalModelTestData.csv` contains sets of inputs and outputs used
  to test the operation of the `AeronauticalStatisticalModel` function.

## License ##

MATLAB is a registered trademark of The MathWorks, Inc. See
[mathworks.com/trademarks](https://mathworks.com/trademarks) for a list of additional trademarks.

"Python" and the Python logos are trademarks or registered trademarks of the Python Software Foundation, used by the National Telecommunications and Information Administration with permission from the Foundation.

## Contact ##

For technical questions, contact <code@ntia.gov>.

## Disclaimer ##

Certain commercial equipment, instruments, or materials are identified in this project were used for the convenience of the developers. In no case does such identification imply recommendation or endorsement by the National Telecommunications and Information Administration, nor does it imply that the material or equipment identified is necessarily the best available for the purpose.
