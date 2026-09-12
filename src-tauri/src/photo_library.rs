use super::*;
use std::collections::HashSet;

#[derive(Clone, Serialize, Deserialize)]
pub struct Point { x: f32, y: f32 }
#[derive(Clone, Serialize, Deserialize)]
pub struct Edit { rotation: f64, distortion: f32, points: Option<Vec<Point>> }
impl Edit {
    pub fn validate(&self) -> Result<(), String> {
        if !self.rotation.is_finite() || !(0.0..360.0).contains(&self.rotation) || !self.distortion.is_finite() || self.distortion.abs() > 0.35 {
            return Err("Invalid correction settings".into());
        }
        if let Some(points) = &self.points {
            if points.len()!=4 || points.iter().any(|p| !p.x.is_finite() || !p.y.is_finite() || !(0.0..=1.0).contains(&p.x) || !(0.0..=1.0).contains(&p.y)) {
                return Err("Invalid corner coordinates".into());
            }
        }
        Ok(())
    }
}
fn path(dir: &Path, name: &str) -> Result<PathBuf,String> {
    if name.is_empty() || Path::new(name).components().count()!=1 || name=="." || name==".." || name.contains('/') || name.contains('\\') {
        return Err("Invalid photo path".into());
    }
    let p=dir.join(name);
    if fs::symlink_metadata(&p).map(|m|m.file_type().is_symlink()).unwrap_or(false) { return Err("Linked photo files are not supported".into()); }
    Ok(p)
}
fn history_write(dir: &Path, photos: &[Photo]) -> Result<(),String> {
    let pending=dir.join(".gesture-camera-history.tmp");
    fs::write(&pending,serde_json::to_vec(photos).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    fs::rename(pending,dir.join(".gesture-camera-history.json")).map_err(|e|e.to_string())
}
fn lookup<'a>(photos: &'a [Photo], id: &str) -> Result<&'a Photo,String> {
    if id.is_empty() || id=="." || id==".." || id.contains('/') || id.contains('\\') { return Err("Invalid photo ID".into()); }
    photos.iter().find(|p|p.id==id).ok_or_else(||"The photo was deleted or the save folder changed. Refresh and try again.".into())
}

#[tauri::command]
pub fn load_photo(state: State<Storage>, id: String, source: bool) -> Result<serde_json::Value,String> {
    let dir=state.folder.lock().map_err(|e|e.to_string())?;
    let photos=read_history(&dir)?;let photo=lookup(&photos,&id)?;
    let backup=photo.original.as_ref().filter(|n|*n!=&photo.filename);
    let filename=if source {backup.unwrap_or(&photo.filename)}else{&photo.filename};
    let bytes=fs::read(path(&dir,filename)?).map_err(|e|format!("Could not read photo: {e}"))?;
    Ok(serde_json::json!({"data":format!("data:image/png;base64,{}",STANDARD.encode(bytes)),"originalBackup":backup.is_some(),"edit":if source && backup.is_some(){photo.edit.as_ref()}else{None},"revision":photo.revision}))
}

fn replace_in(dir: &Path, id: &str, revision: u64, image: &str, thumbnail: String, edit: Edit) -> Result<Photo,String> {
    edit.validate()?;
    let (bytes,width,height)=decode_png(image)?;
    if !thumbnail.starts_with("data:image/jpeg;base64,") || thumbnail.len()>300_000 { return Err("Invalid thumbnail".into()); }
    let mut photos=read_history(dir)?;
    let photo=lookup(&photos,id)?;
    if photo.revision!=revision { return Err("This photo has changed. Reopen the editor.".into()); }
    let target=path(dir,&photo.filename)?;
    let pending=dir.join(format!(".{}.editing",photo.id));
    write_new(&pending,&bytes)?;
    let rollback=dir.join(format!(".{}.previous",photo.id));
    // Keep the prior primary until both the image and history are committed.
    if let Err(e)=fs::rename(&target,&rollback) {let _=fs::remove_file(pending);return Err(e.to_string());}
    if let Err(e)=fs::rename(&pending,&target) {let _=fs::rename(&rollback,&target);let _=fs::remove_file(pending);return Err(e.to_string());}
    let p=photos.iter_mut().find(|p|p.id==id).unwrap();
    if p.original.as_ref()==Some(&p.filename) {p.original=None;}
    p.width=width;p.height=height;p.thumbnail=thumbnail;p.edit=Some(edit);p.revision+=1;
    let updated=p.clone();
    if let Err(e)=history_write(dir,&photos) {
        fs::rename(&rollback,&target).map_err(|r|format!("{e}; recovery failed: {r}. The previous version is saved at {}",rollback.display()))?;
        return Err(e);
    }
    let _=fs::remove_file(rollback);
    Ok(updated)
}
#[tauri::command]
pub fn replace_photo(state: State<Storage>, id: String, revision: u64, image: String, thumbnail: String, edit: Edit) -> Result<Photo,String> {
    let dir=state.folder.lock().map_err(|e|e.to_string())?;
    replace_in(&dir,&id,revision,&image,thumbnail,edit)
}

fn reorder_in(dir: &Path, ids: Vec<String>) -> Result<(),String> {
    let photos=read_history(dir)?;
    let actual: HashSet<_>=photos.iter().map(|p|p.id.as_str()).collect();
    let requested: HashSet<_>=ids.iter().map(String::as_str).collect();
    if ids.len()!=photos.len() || requested.len()!=ids.len() || actual!=requested {return Err("The photo list has changed. Try reordering again.".into());}
    let ordered: Vec<_>=ids.iter().rev().map(|id|photos.iter().find(|p|&p.id==id).unwrap().clone()).collect();
    history_write(dir,&ordered)
}
#[tauri::command]
pub fn reorder_photos(state: State<Storage>, ids: Vec<String>) -> Result<(),String> {
    let dir=state.folder.lock().map_err(|e|e.to_string())?;reorder_in(&dir,ids)
}
fn delete_in(dir: &Path,id: &str) -> Result<(),String> {
    let mut photos=read_history(dir)?;let photo=lookup(&photos,id)?.clone();
    // A local recovery folder keeps deletion reversible without touching other photos.
    let trash=dir.join(".gesture-camera-deleted").join(&photo.id);
    fs::create_dir_all(&trash).map_err(|e|e.to_string())?;
    fs::write(trash.join("photo.json"),serde_json::to_vec(&photo).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    let mut names=vec![photo.filename.clone()];
    if let Some(n)=photo.original {if !names.contains(&n){names.push(n);}}
    let mut moved: Vec<(PathBuf,PathBuf)>=Vec::new();
    let result=(||{
        for name in names {
            let from=path(dir,&name)?;let to=trash.join(&name);
            if from.exists(){fs::rename(&from,&to).map_err(|e|e.to_string())?;moved.push((from,to));}
        }
        photos.retain(|p|p.id!=id);history_write(dir,&photos)
    })();
    if result.is_err(){for(from,to)in moved.iter().rev(){let _=fs::rename(to,from);}}
    result
}
#[tauri::command]
pub fn delete_photo(state: State<Storage>, id: String) -> Result<(),String> {
    let dir=state.folder.lock().map_err(|e|e.to_string())?;delete_in(&dir,&id)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(label: &str, backup: bool) -> PathBuf {
        let dir=std::env::temp_dir().join(format!("gallery-{}-{label}",std::process::id()));let _=fs::remove_dir_all(&dir);fs::create_dir_all(&dir).unwrap();
        let mut photos=vec![];
        for id in ["one","two"] {
            let filename=format!("{id}.png");fs::write(dir.join(&filename),b"old primary").unwrap();
            let original=if backup {let name=format!("{id}-original.png");fs::write(dir.join(&name),b"untouched original").unwrap();Some(name)}else{Some(filename.clone())};
            photos.push(Photo{id:id.into(),filename,original,width:100,height:80,created:0,thumbnail:"data:image/jpeg;base64,".into(),edit:None,revision:0});
        }
        history_write(&dir,&photos).unwrap();dir
    }
    fn png() -> String {let mut p=b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();p.extend_from_slice(&40u32.to_be_bytes());p.extend_from_slice(&30u32.to_be_bytes());p.resize(33,0);STANDARD.encode(p)}
    fn edit() -> Edit {Edit{rotation:0.,distortion:0.,points:None}}
    #[test]
    fn accepts_fractional_rotation_and_legacy_integer_metadata() {
        let value: Edit=serde_json::from_str(r#"{"rotation":32.5,"distortion":0,"points":null}"#).unwrap();
        assert!(value.validate().is_ok());
        let legacy: Edit=serde_json::from_str(r#"{"rotation":90,"distortion":0,"points":null}"#).unwrap();
        assert!(legacy.validate().is_ok());
        for rotation in [-1.0,360.0,f64::NAN,f64::INFINITY] {assert!(Edit{rotation,..edit()}.validate().is_err());}
    }
    #[test]
    fn editing_preserves_backup_and_replaces_primary() {
        let dir=fixture("backup",true);
        let p=replace_in(&dir,"one",0,&png(),"data:image/jpeg;base64,".into(),edit()).unwrap();
        assert_eq!(fs::read(dir.join("one-original.png")).unwrap(),b"untouched original");assert_eq!(p.width,40);assert_eq!(p.revision,1);
        assert!(replace_in(&dir,"one",0,&png(),"data:image/jpeg;base64,".into(),edit()).is_err());
        assert_eq!(fs::read(dir.join("two.png")).unwrap(),b"old primary");fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn editing_without_backup_uses_and_replaces_current_photo() {
        let dir=fixture("no-backup",false);
        let p=replace_in(&dir,"one",0,&png(),"data:image/jpeg;base64,".into(),edit()).unwrap();
        assert!(p.original.is_none());assert_eq!(p.filename,"one.png");assert_eq!(read_history(&dir).unwrap().len(),2);fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn reorder_and_delete_keep_other_photos_and_recovery_files() {
        let dir=fixture("order",true);reorder_in(&dir,vec!["one".into(),"two".into()]).unwrap();
        assert_eq!(read_history(&dir).unwrap()[1].id,"one");assert!(reorder_in(&dir,vec!["one".into(),"one".into()]).is_err());
        delete_in(&dir,"one").unwrap();assert_eq!(read_history(&dir).unwrap().len(),1);
        assert!(!dir.join("one.png").exists());assert!(dir.join(".gesture-camera-deleted/one/one-original.png").exists());assert!(dir.join("two.png").exists());fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn failed_history_commit_restores_photo_and_metadata() {
        let dir=fixture("edit-rollback",true);
        fs::create_dir(dir.join(".gesture-camera-history.tmp")).unwrap();
        assert!(replace_in(&dir,"one",0,&png(),"data:image/jpeg;base64,".into(),edit()).is_err());
        assert_eq!(fs::read(dir.join("one.png")).unwrap(),b"old primary");
        assert_eq!(read_history(&dir).unwrap()[0].revision,0);
        assert_eq!(fs::read(dir.join("one-original.png")).unwrap(),b"untouched original");
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn failed_delete_commit_restores_both_files() {
        let dir=fixture("delete-rollback",true);
        fs::create_dir(dir.join(".gesture-camera-history.tmp")).unwrap();
        assert!(delete_in(&dir,"one").is_err());
        assert_eq!(fs::read(dir.join("one.png")).unwrap(),b"old primary");
        assert_eq!(fs::read(dir.join("one-original.png")).unwrap(),b"untouched original");
        assert_eq!(read_history(&dir).unwrap().len(),2);
        fs::remove_dir_all(dir).unwrap();
    }

}
