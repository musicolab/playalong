import { annotationList, chordEditor, deleteAnnotationBtn, disableAnnotationListAndDeleteAnnotation, disableSaveChordsAndCancelEditing, toggleEditBtn, toolbarStates } from "../../annotation-tools";
import { _createNewAnnotation, closeModal, editChord, showChordEditor } from "../../annotation-tools/right-toolbar-tools";
import { analysisLoadingBar, animateProgressBar, audioSidebarText, toolbar, wavesurfer } from "../../audio-player";
import { zoomIn, zoomOut } from "../../audio-player/player-controls";
import { createAnnotationsList, jamsFile, loadJAMS, renderAnnotations, selectedAnnotationData, updateMarkerDisplayWithColorizedRegions } from "../../audio-player/render-annotations";
import { tooltips } from "../../components/tooltips";
import { setUserImageUrl, renderUserList } from "./users";
import { handleMarkerSelection } from "./sharedTypesHandlers";

export function stateChangeHandler(changes) {
  const awStates = Array.from(
    window.awareness.getStates().entries()
  );
  const myClientId = window.awareness.clientID;
    console.log({awStates, myClientId});

  actOnBTAnalysisStateUpdate(awStates, myClientId);
  actOnRecordStateUpdate(awStates, myClientId);
  actOnBTrackEditStateUpdate(awStates, myClientId);
  actOnChordEditStateUpdate(awStates, myClientId);
  actOnCancelSaveEditStateUpdate(awStates, myClientId);
}

export function awaranessUpdateHandler() {
  const { connectedUsers, disconnectedUsers, reconnectedUserNames } = formatUserList();

  configureDeleteWaveformButtons(reconnectedUserNames, disconnectedUsers);
  updateWaveformAwareness(connectedUsers);
  renderUserList([...connectedUsers, ...disconnectedUsers]);
}

function actOnBTAnalysisStateUpdate (awStates, myClientId) {
  const BTAnalysisStateUpdates = awStates
    .filter( ( [, state] )=> state.BTAnalysis)
    .map( ( [id, state] ) => {return [id, state.BTAnalysis, state.user.name]} );
  if (!BTAnalysisStateUpdates.length)   return;

  BTAnalysisStateUpdates.forEach( ( [changeClientId, BTAnalysisState, analyzerName] ) => {
    const myStateUpdating = (changeClientId === myClientId);

    switch (BTAnalysisState.status) {
      case 'initiated': actOnBTAnalysisInitiated(myStateUpdating, analyzerName) 
        break;
      case 'inProgress': actOnBTAnalysisInProgress(myStateUpdating, BTAnalysisState.progress)
        break;
      case 'completed': actOnBTAnalysisCompleted(myStateUpdating, BTAnalysisState.jamsURL)
        break;
    }
  });
}

function actOnBTAnalysisInProgress (me, progress) {
  if (me) return;
  animateProgressBar(analysisLoadingBar, progress, 'Analysing');
}

function actOnBTAnalysisInitiated (me, analyzerName) {
  if (me) return;
  //notifying about analysis button having been clicked
  const notifText = `${analyzerName} has has clicked Analyze button. Waiting for the analysis result...`;
  const notifContext = 'info';
  notify(notifText, notifContext);
  //modifying BT toolbar  
  document.getElementById(`preface-annotation`).classList.add('d-none');
  analysisLoadingBar.classList.remove('d-none');
}

function actOnBTAnalysisCompleted (me, jamsURL) {
  if (me) {
    setTimeout(
      () => window.awareness.setLocalStateField('BTAnalysis', null)
    , 1000);

    return;
  }

  function callback () {
    //modifying toolbar GUI
    document.getElementById(`preface-annotation`).classList.remove('d-none');
    analysisLoadingBar.classList.add('d-none');  
  }

  //notifying that analysis by server script has been completed
  if (jamsURL == 'none') {
    const notifText = `Backing track analysis has failed.`;
    const notifContext = 'danger';
    notify(notifText, notifContext);

    callback();
  } else {
    const notifText = `Backing track analysis completed!`;
    const notifContext = 'info';
    notify(notifText, notifContext);

    animateProgressBar(analysisLoadingBar, 100, 'Analysing', callback);

    loadJAMS(jamsURL);
  }
}

function actOnCancelSaveEditStateUpdate(awStates, myClientId) {
  const cancelSaveEditStateUpdates = awStates
    .filter( ([, state]) => state.cancelSaveEdit )
    .map( ([id, state]) => {return [id, state.cancelSaveEdit, state.user]} );
  if (!cancelSaveEditStateUpdates.length)   return;

  cancelSaveEditStateUpdates.forEach( ( [editorClientId, cancelSaveEditState, editorData] ) => {
    const myStateUpdating = (editorClientId === myClientId);

    switch(cancelSaveEditState.action) {
      case 'canceled': handleCancelEditing(myStateUpdating, editorData.name)
        break; 
      case 'saved, replacedCurrentAnnotation': handleSaveEditing(
        'replace',
         myStateUpdating,
         editorData.name,
         cancelSaveEditState.newAnnotationData
      )
        break;
      case 'saved, savedAsSeparateAnnotation': handleSaveEditing(
        'saveSeparately',
        myStateUpdating,
        editorData.name,
        cancelSaveEditState.newAnnotationData 
      )
        break;
    }


    if (myStateUpdating) {
      setTimeout(
        () => window.awareness.setLocalStateField('cancelSaveEdit', null)
        , 1000);

      window.sharedBTMarkers.forEach( (v, k, thisMap) => thisMap.delete(k) );
      wavesurfer
        .markers
        .markers
        .forEach( (marker, index) => 
          window.sharedBTMarkers.set(`${index}`,
            {
              time: marker.time,
              status: 'unedited',
              metadata: {}
          }
      ));      
    }
  });
}

function handleSaveEditing (choice, me, editorName, newAnnotationData) {
  if (me) {
    if ( choice === 'replace' ) {
      //delete every shared parameter except annotaionSel since it hasn t changed
      window.sharedBTEditParams.forEach( (v, k, thisMap) => {
        if (k !== 'annotationSel')
          thisMap.delete(k);
       });
    } else if (choice = 'saveSeparately') {
      //delete every shared parameter and set annotationSel to 
      window.sharedBTEditParams.forEach( (v, k, thisMap) => thisMap.delete(k));
      //window.sharedBTEditParams.set('annotationSel', {value: this.value, selector: userParam}) TODO
    }
    return;
  }
  //needs to be called before updateMarkerDisplay so as visualizations are rendered correctly 
  disableSaveChordsAndCancelEditing();

  const newAnnotation = _createNewAnnotation(newAnnotationData);
  let index = annotationList.selectedIndex;
  if (choice === 'replace'){
    wavesurfer.clearMarkers();
    jamsFile.annotations[index] = newAnnotation;
    renderAnnotations(selectedAnnotationData(jamsFile));
  } else if (choice === 'saveSeparately') {
    jamsFile.annotations.push(newAnnotation);
    index = annotationList.length;
    updateMarkerDisplayWithColorizedRegions(true);
  }
  createAnnotationsList(jamsFile);
  annotationList.selectedIndex = index;

  deleteAnnotationBtn.classList.remove('disabled');

  //save notification
  const notifText = `${editorName} has saved current backing track edit
    ${choice === 'replace' ? ' replacing the current annotation' : ' as a separate annotation'}`;
  const notifContext = 'info';
  notify(notifText, notifContext);
}

function handleCancelEditing (me, editorName) {
  if (me) {
    //editor clears shared editParams objects, except the annotationSelected param whis stays the same
    window.sharedBTEditParams.forEach( (v, k, thisMap) => {
      if (k !== 'annotationSel')
        thisMap.delete(k);
    });

    return;
  }

  wavesurfer.clearMarkers();
  // This needs to be called before updateMarkerDisplay WithColorizedRegions that s called in renderAnnotations
  disableSaveChordsAndCancelEditing();
  renderAnnotations(selectedAnnotationData(jamsFile));

  //cancel notification
  const notifText = `${editorName} has canceled current backing track edit.`;
  const notifContext = 'info';
  notify(notifText, notifContext);
}

function actOnChordEditStateUpdate (awStates, myClientId) {
  const chordEditStateUpdates = awStates
    .filter( ([, state]) => state.chordEdit )
    .map( ([id, state]) => {return [id, state.chordEdit]} );
  if (!chordEditStateUpdates.length)   return;

  chordEditStateUpdates.forEach( ( [editorClientId, chordEditState] ) => {
    const myStateUpdating = (editorClientId === myClientId);

    switch (chordEditState.status) {
      case 'started': actOnChordEditStarted(myStateUpdating, chordEditState.selection) 
        break;
      case 'completed': actOnChordEditCompleted(myStateUpdating, chordEditState)
        break;
      //cases where user enters later in edit session at a moment when chord editing is in progress
      //status 'inProgress' has been set in editor's actOnChordEditStarted call
      case 'inProgress': actOnChordEditInProgress(chordEditState.initialSelection) 
        break; 
    }
  });
}

function actOnChordEditInProgress(initialSelection) {
  //in cases chord editor already shown return
  //i.e. when user was present from the beginning of chord edit session
  if (toolbarStates.IS_MODAL_TABLE_ACTIVE)
    return;
  //if user enters in the middle of chord session, therefore in the middle of edit session as well,
  //set timeout, so as chord started events occur after edit initiated events
  //note: in cases of 'late' users, edit initiated events occur 2 seconds after user connection

  setTimeout(
    () => {
      const currentSelection = 
        window.sharedBTEditParams.get('chordSel')
        ?? initialSelection;
      actOnChordEditStarted(false, currentSelection);
    }
    , 2500);
}

function actOnChordEditStarted (me, selection) {
  //if user = editor set transition to 'inProgress' status of user's chordEditState
  //to occur after current awareness handler (chordEditState.status = 'started') has run 
  if (me) {
    setTimeout(
      () => window.awareness.setLocalStateField('chordEdit', {status: 'inProgress', initialSelection: selection})
      , 1000);

    return;
  }

  showChordEditor(selection);
}

function actOnChordEditCompleted (me, editState) {
  if (me) {
    setTimeout(
      () => window.awareness.setLocalStateField('chordEdit', null),
      200);
    return;
  } else {
    chordEditor
      .querySelectorAll(`.collaboratively-selected`)
      .forEach(prevSel => {
        prevSel._tippy.destroy();
        prevSel.classList.remove(`collaboratively-selected`);
    });

    switch(editState.completingAction) {
      case 'canceled': null;
        break;
      case 'applied': {
        editChord(false, editState.chordSelection);
        disableAnnotationListAndDeleteAnnotation();
      }
        break;
    }

    closeModal();
  }
}

function actOnBTrackEditStateUpdate (awStates, myClientId) {
  const bTrackEditStateUpdates = awStates
    .filter( ([, state]) => state.bTrackEdit )
    .map( ([id, state]) => {return [id, state.bTrackEdit, state.user]} );

  if (!bTrackEditStateUpdates.length)   return;

  bTrackEditStateUpdates.forEach( ( [editorClientId, editState, editorData] ) => {
    const myStateUpdating = (editorClientId === myClientId);

    switch (editState.status) {
      case 'editInitiated': actOnBTrackEditInitiated(myStateUpdating, editorData, editState.editTime) 
        break;
      case 'editCompleted': actOnBTrackEditCompleted(myStateUpdating, editorData, editState.editTime)
        break;
      case 'editInProgress' : {
        !myStateUpdating && !toolbarStates.COLLAB_EDIT_MODE
          //in case user enters session after collab edit has started ('late' user)
          //set:
          //1.edit initiated events to occur in two seconds so as backing track code has been executed 
          //2.currently collably selected marker to be selected
          ? setTimeout(
              () => { 
                actOnBTrackEditInitiated(myStateUpdating, editorData, editState.editTime);
                const selectedMarkerTime =
                  window.sharedBTEditParams.get('selectedMarker');
                handleMarkerSelection(selectedMarkerTime);
              }
              ,2000)
          //case where 'edit Initiated' has already run, i.e. when user was present from the beginning of edit session
          : null; 
      }
        break;
    }
  });
}

function actOnBTrackEditInitiated (me, editorData, editTime) {
  bTeditor = editorData.name;

  if (!me) {
  toolbarStates.COLLAB_EDIT_MODE = true;

  modifyChordFinderUI(true, editorData, editTime);
  //notification
  const notifText = `${editorData.name} is editing the backing track. You can't edit at the same time.`;
  const notifContext = 'info';
  notify(notifText, notifContext);

  } else {
    //setting the shared markers map if not already existing, i.e. when there has been no previous edit
    //or when cancel/save editing has preceded and shared markers object is reset
    if (!window.sharedBTMarkers.size) {
      wavesurfer
        .markers
        .markers
        .forEach( (marker, index) => 
          window.sharedBTMarkers.set(`${index}`,
            {
              time: marker.time,
              status: 'unedited',
              metadata: {}
          }
      ));
    }
    //entering 'inProgress' reasons:
    //1)user that enters session after edit has began, needs to run edit initiate events
    //2) edit initiate events should not rerun during other awareness updates (eg.chordEdit), so status has to be changed
    setTimeout( 
      () => window.awareness.setLocalStateField('bTrackEdit', {
              status: 'editInProgress',
              editTime: null})
      , 1000);
  }
}

function actOnBTrackEditCompleted (me, editorData, editTime) {
  bTeditor = null; //TODO. delete if btEditor name not needed
  


  if (me) {
    //deactivate edit btn until bTrackEdit status is null, so as to avoid bugs relative to rapid edit btn clicking
    toggleEditBtn.setAttribute('disabled', true);
    setTimeout(
      () => {
        toggleEditBtn.removeAttribute('disabled');
        window.awareness.setLocalStateField('bTrackEdit', null)
      }
    , 200);
    return;
  }

  toolbarStates.COLLAB_EDIT_MODE = false;
  
  modifyChordFinderUI(false, editorData, editTime);
  //notification
  const notifText = `${editorData.name} has stopped editing the backing track. You can now edit at will.`;
  const notifContext = 'info';
  notify(notifText, notifContext);
}

function modifyChordFinderUI(collabEditModeOn, editorData, editTime) {
  collabEditModeOn ? zoomIn() : zoomOut();

  if (editTime) {
    if (editTime === wavesurfer.getDuration()) {
      wavesurfer.seekTo(0);
    } else {
      const progress = editTime / wavesurfer.getDuration();
      wavesurfer.seekAndCenter(progress);
    }
  }

  updateMarkerDisplayWithColorizedRegions(true);
  collabEditModeOn 
    ? tooltips.regions[0].disable()
    : tooltips.regions[0].enable();

  //toolbars UI
  const centerToolbar = document.getElementById('center-toolbar-controls');
  if (collabEditModeOn) {
    toolbar.classList.remove('editing-on');
    toolbar.style.backgroundColor = editorData.color;


    [...centerToolbar.children].forEach(child => child.setAttribute('hidden', true));
    const infoSpan = document.createElement('span');
    infoSpan.innerText = `${editorData.name} is editing!`;
    centerToolbar.appendChild(infoSpan);
  } else {
    toolbar.removeAttribute('style');
    
    centerToolbar.removeChild(
      centerToolbar.querySelector('span')
    );
    [...centerToolbar.children].forEach(child => child.removeAttribute('hidden'));
  }
  audioSidebarText.classList.toggle('buttons-inactive'); 
}

function actOnRecordStateUpdate (awStates, myClientId) {
  const recordStateUpdates = awStates
    .filter( ( [, state] )=> state.record)
    .map( ( [id, state] ) => {return [id, state.record]} );
  if (!recordStateUpdates.length)   return;

  recordStateUpdates.forEach( ( [changeClientId, rState] ) => {
    const myStateUpdating = (changeClientId === myClientId);
    const recUserData = {
      name: rState.recUserData.name,
      id: rState.recUserData.id,
      imageSrc: setUserImageUrl(rState.recUserData.id)
    };

    switch (rState.status) {
      case 'start': actOnStartRecording(myStateUpdating, recUserData) 
      break;
      case 'stop': actOnStopRecording(myStateUpdating, recUserData.name, rState.isValid)
      break;
    }
  });
}

function actOnStartRecording(me, recUserData) {
  recordButton.classList.add("flash");

  createRecordingTemplate(recUserData);

  if (!me) {
    otherUserRecording = true;

    const notifText = `${recUserData.name} is recording. You can't record at the same time.`;
    const notifContext = 'info';
    notify(notifText, notifContext);
  }
}

function actOnStopRecording(me, userName, isValid) {
  //removing user image and recording button flashing
  recordButton.classList.remove('flash');


  if (isValid) {
    document
      .getElementById(`scrollContainer${count}`)
      .previousElementSibling
      .classList.remove('flash');
    
    if (!me) {
      //display all buttons needed when rec exists. enable playback speed bar
      let additionalButtonsToDisplay = [
        'stopallButton',
        'combineselectedButton',
        'playpauseallButton'
      ];    
      additionalButtonsToDisplay = additionalButtonsToDisplay
        .map(id => document.getElementById(id));
      additionalButtonsToDisplay.forEach(e => e.removeAttribute('hidden', false));
      additionalButtonsToDisplay[2].innerHTML=
        '<svg xmlns="http://www.w3.org/2000/svg" width="45" height="45" fill="green" class="bi bi-play-fill" viewBox="0 0 16 16"><path d="m11.596 8.697-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393z"/></svg>'
      ;      
      document.getElementById('speedSlider').disabled = false;      
    } 
  } else {
    document
    .getElementById(`scrollContainer${count}`)
    .parentElement
    .remove();
  }

  if (me) {
    setTimeout(
      () => window.awareness.setLocalStateField('record', null),
      100);  
  } else {    
    otherUserRecording = false;

    const notifText = `${userName} has stopped recording.
      ${isValid ? 'Recording is valid.' : 'Recording is not valid.'}`;
    const notifContext = 'info';
    notify(notifText, notifContext);
  }
}

function formatUserList() {
  const awStates = window.awareness.getStates();
  let connectedUsers = [...awStates.entries()].map(
    (e) => (e = `user=${e[1].user.name} id=${e[1].user.id}`)
  );

  let disconnectedUsers = [...window.permanentUserData.clients.values()].filter(
    (entry) => !connectedUsers.includes(entry)
  );

  let prevDisconectedUsers = []
  let reconnectedUserNames = [];
  //configuring the connected users list
  connectedUsers = [...new Set(connectedUsers)]
    .map((entry) => entry.concat(" status=online"))
    .map((entry) => {
      const data = entry.match(
        /user=(?<name>.+?) id=(?<id>\d+) status=(?<status>\w+)/
      ).groups;
      return data;
    });
  connectedUsers.forEach((user) => (user.imageSrc = setUserImageUrl(user.id)));
  //configuring the disconnected users list
  disconnectedUsers = [...new Set(disconnectedUsers)]
    .map((entry) => entry.concat(" status=offline"))
    .map((entry) => {
      const data = entry.match(
        /user=(?<name>.+?) id=(?<id>\d+) status=(?<status>\w+)/
      ).groups;
      return data;
    });
  disconnectedUsers.forEach(
    (user) => (user.imageSrc = setUserImageUrl(user.id))
  );
  //configuring the reconnected users list
  const connectedNames = connectedUsers.map(user => user.name);
  document
    .querySelectorAll('.offline-status')
    .forEach( e => prevDisconectedUsers.push(e.nextElementSibling.textContent) );
  reconnectedUserNames = prevDisconectedUsers
    .filter( user => connectedNames.includes(user) );

  return { connectedUsers, disconnectedUsers, reconnectedUserNames };
}

function updateWaveformAwareness(connected) {
  const connectedNames = connected.map((user) => user.name);
  const wfImages = [...document.querySelectorAll(".waveform-awareness")];
  wfImages.forEach((img) => {
    if (connectedNames.includes(img.title)) {
      img.classList.remove("recUser-offline");
      img.classList.add("recUser-online");
    } else {
      img.classList.remove("recUser-online");
      img.classList.add("recUser-offline");
    }
  });
}
function configureDeleteWaveformButtons(reconnectedNames, disconnectedUsers) {
  //make delete buttons of recordings by disconnected users visible for everyone
  const disconnectedNames = disconnectedUsers.map(u => u.name);
  const recordingsByDisconnected = [...document.querySelectorAll('.waveform-awareness')]
    .filter(imageEl => disconnectedNames.includes(imageEl.title))
    .forEach(imageEl => {
      const recCount = imageEl
        .nextElementSibling
        .id.match(/\d+/)[0];
      const recButtonsContainer = document
        .querySelector(`#buttons${recCount}`);
      recButtonsContainer.querySelector('.delete-button')
        .removeAttribute('hidden');
    });
  
  //rehide (for all users except the recorder) delete buttons of recordings by reconnected users
  const recordingsByReconnected = [...document.querySelectorAll('.waveform-awareness')]
    .filter(imageEl => reconnectedNames.includes(imageEl.title))
    .forEach(imageEl => {
      if (imageEl.title == userParam)
        return;
      const recCount = imageEl
        .nextElementSibling
        .id.match(/\d+/)[0];
      const recButtonsContainer = document
        .querySelector(`#buttons${recCount}`);
      recButtonsContainer.querySelector('.delete-button')
        .setAttribute('hidden', true);
    })  ;
}
