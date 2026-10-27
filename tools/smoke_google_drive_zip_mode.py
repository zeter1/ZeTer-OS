"""ZIP-only native preferences: isolated temporary fixtures, zero cloud writes."""
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import run_zeter_os as osapp
from google_drive_backup import GoogleDriveBackup
from smoke_google_drive_backup import protector
from smoke_managed_file_native import configure_temp_data,RecordingPlatformOpener

def main():
    with tempfile.TemporaryDirectory(prefix='zeter-zip-cloud-smoke-') as temp:
        root=Path(temp)
        configure_temp_data(root)
        api=osapp.NativeStorageApi(platform_opener=RecordingPlatformOpener(),google_drive_credentials_root=root/'credentials')
        api._google_drive=GoogleDriveBackup(api,osapp,protector=protector,credentials_root=root/'credentials',browser=lambda _:None)
        assert api.google_drive_zip_preferences()=={'ok':True,'value':None}
        value={'enabled':True,'intervalHours':24,'lastSuccessAt':1793000000000}
        assert api.google_drive_zip_preferences({'value':value})=={'ok':True,'value':value}
        assert api.google_drive_zip_preferences()['value']==value
        other=osapp.NativeStorageApi(platform_opener=RecordingPlatformOpener(),google_drive_credentials_root=root/'credentials')
        other._google_drive=GoogleDriveBackup(other,osapp,protector=protector,credentials_root=root/'credentials',browser=lambda _:None)
        assert other.google_drive_zip_preferences()['value']==value
        for invalid in ({'value':{**value,'intervalHours':0}}, {'value':{**value,'extra':'secret'}},
                        {'value':{**value,'enabled':'yes'}},{'value':{**value,'lastSuccessAt':-1}}):
            assert other.google_drive_zip_preferences(invalid)['ok'] is False
        assert other.google_drive_zip_preferences()['value']==value
        new_data=root/'another-install'/'data';new_data.mkdir(parents=True)
        osapp.DATA_DIR=new_data
        assert other.google_drive_zip_preferences()['value'] is None
        osapp.DATA_DIR=root/'data'
        assert other.google_drive_zip_preferences()['value']==value
    print('ZIP_CLOUD_PREFERENCES_PASS: durable DPAPI fixture, per-install isolation, strict validation, no cloud data mutations')

if __name__=='__main__':
    main()
